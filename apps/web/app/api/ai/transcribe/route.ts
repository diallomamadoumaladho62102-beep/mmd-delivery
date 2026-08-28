import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getOpenAiApiKey } from "@/lib/ai/aiConfig";
import { aiJson } from "@/lib/ai/aiJson";
import { persistAiEvent } from "@/lib/ai/aiMetrics";
import { checkAiRateLimitDistributed } from "@/lib/ai/aiRateLimitSupabase";
import { assertAiOperational } from "@/lib/ai/aiScopeGate";
import { requireAiApiUser } from "@/lib/ai/requireAiApiUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_AUDIO_BYTES = 8_000_000;
const WHISPER_LOCALES = new Set(["en", "fr", "es", "ar", "zh"]);

export async function POST(req: NextRequest) {
  const auth = await requireAiApiUser(req, { clientOnly: true });
  if (auth.ok === false) return auth.response;

  const operational = await assertAiOperational({
    supabaseAdmin: auth.supabaseAdmin,
    userId: auth.user.id,
    req,
  });
  if (operational.ok === false) return operational.response;

  const rate = await checkAiRateLimitDistributed({
    supabaseAdmin: auth.supabaseAdmin,
    userId: auth.user.id,
  });
  if (rate.allowed === false) {
    return aiJson(
      { ok: false, error: "Rate limit exceeded", code: "AI_RATE_LIMIT", retryAfter: rate.retryAfter },
      429
    );
  }

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return aiJson({ ok: false, error: "OPENAI_API_KEY not configured", code: "OPENAI_ERROR" }, 503);
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    const locale = String(form.get("locale") ?? "en").split("-")[0].toLowerCase();

    if (!(file instanceof File) || file.size < 32) {
      return aiJson({ ok: false, error: "audio file is required", code: "INVALID_REQUEST" }, 400);
    }
    if (file.size > MAX_AUDIO_BYTES) {
      return aiJson({ ok: false, error: "audio file too large", code: "INVALID_REQUEST" }, 413);
    }

    const openai = new OpenAI({ apiKey });
    const language = WHISPER_LOCALES.has(locale) ? locale : undefined;
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      ...(language ? { language } : {}),
    });

    const text = String(transcription.text ?? "").trim();
    // Transcription only. Content policy runs in runMmdAiChat via POST /api/ai/chat.
    return aiJson({
      ok: true,
      text,
      locale,
      languageUsed: language ?? "auto",
      fallbackLanguage: language ? null : "auto",
    });
  } catch (err) {
    await persistAiEvent({
      supabaseAdmin: auth.supabaseAdmin,
      eventType: "mmd_ai_error",
      userId: auth.user.id,
      errorCode: "OPENAI_ERROR",
    });
    const msg = err instanceof Error ? err.message : "Transcription failed";
    return aiJson({ ok: false, error: msg, code: "OPENAI_ERROR" }, 500);
  }
}
