import { NextRequest } from "next/server";
import { logAiAudit } from "@/lib/ai/aiAudit";
import { runMmdAiChat } from "@/lib/ai/aiAgent";
import {
  getAiMaxHistoryTurns,
  getAiMaxMessageLength,
} from "@/lib/ai/aiConfig";
import { aiJson } from "@/lib/ai/aiJson";
import { checkAiRateLimit, getClientIp } from "@/lib/ai/aiRateLimit";
import type { AiChatRequest } from "@/lib/ai/aiTypes";
import { requireAiApiUser } from "@/lib/ai/requireAiApiUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_768;

export async function POST(req: NextRequest) {
  const started = Date.now();

  try {
    const rawBody = await req.text();
    if (rawBody.length > MAX_BODY_BYTES) {
      return aiJson(
        { ok: false, error: "Request body too large", code: "INVALID_REQUEST" },
        413
      );
    }

    let body: AiChatRequest;
    try {
      body = JSON.parse(rawBody) as AiChatRequest;
    } catch {
      return aiJson({ ok: false, error: "Invalid JSON body", code: "INVALID_REQUEST" }, 400);
    }

    const message = String(body.message ?? "").trim();
    if (!message) {
      return aiJson({ ok: false, error: "message is required", code: "INVALID_REQUEST" }, 400);
    }
    if (message.length > getAiMaxMessageLength()) {
      return aiJson({ ok: false, error: "message too long", code: "INVALID_REQUEST" }, 400);
    }
    if ((body.history?.length ?? 0) > getAiMaxHistoryTurns()) {
      return aiJson({ ok: false, error: "history too long", code: "INVALID_REQUEST" }, 400);
    }

    const auth = await requireAiApiUser(req, { clientOnly: true });
    if (auth.ok === false) return auth.response;

    const rate = checkAiRateLimit(auth.user.id);
    if (rate.allowed === false) {
      return aiJson(
        {
          ok: false,
          error: "Rate limit exceeded",
          code: "AI_RATE_LIMIT",
          retryAfter: rate.retryAfter,
        },
        429
      );
    }

    const response = await runMmdAiChat({ req, auth, body: { ...body, message } });

    logAiAudit({
      ts: new Date().toISOString(),
      userId: auth.user.id,
      role: auth.aiRole,
      locale: response.message.locale,
      toolsUsed: response.meta.toolsUsed,
      latencyMs: Date.now() - started,
      escalated: response.meta.escalatedToHuman,
      conversationId: response.conversationId,
      messageLength: message.length,
      ip: getClientIp(req),
    });

    return aiJson(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "MMD AI unavailable";
    const code = msg.includes("OPENAI") ? "OPENAI_ERROR" : "AI_UNAVAILABLE";
    return aiJson({ ok: false, error: msg, code }, 500);
  }
}
