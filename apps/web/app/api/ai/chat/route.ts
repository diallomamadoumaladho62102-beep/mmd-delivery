import { NextRequest } from "next/server";
import { logAiAudit } from "@/lib/ai/aiAudit";
import { runMmdAiChat } from "@/lib/ai/aiAgent";
import {
  getAiMaxHistoryTurns,
  getAiMaxMessageLength,
} from "@/lib/ai/aiConfig";
import { aiJson } from "@/lib/ai/aiJson";
import { persistAiChatMetrics, persistAiEvent } from "@/lib/ai/aiMetrics";
import { checkAiRateLimitDistributed } from "@/lib/ai/aiRateLimitSupabase";
import { getClientIp } from "@/lib/ai/aiRateLimit";
import { assertAiOperational, type AiScopeContext } from "@/lib/ai/aiScopeGate";
import type { AiChatRequest } from "@/lib/ai/aiTypes";
import { requireAiApiUser } from "@/lib/ai/requireAiApiUser";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 32_768;

export async function POST(req: NextRequest) {
  const started = Date.now();
  let authUserId: string | undefined;
  let supabaseAdmin: SupabaseClient | undefined;
  let scopeContext: AiScopeContext | undefined;

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
    authUserId = auth.user.id;
    supabaseAdmin = auth.supabaseAdmin;

    const operational = await assertAiOperational({
      supabaseAdmin: auth.supabaseAdmin,
      userId: auth.user.id,
      req,
    });
    if (operational.ok === false) {
      await persistAiEvent({
        supabaseAdmin: auth.supabaseAdmin,
        eventType:
          operational.logEvent === "mmd_ai_cost_cap_reached"
            ? "mmd_ai_cost_cap_reached"
            : "mmd_ai_error",
        userId: auth.user.id,
        errorCode: operational.errorCode,
        messageLength: message.length,
      });
      return operational.response;
    }
    scopeContext = operational.scopeContext;

    const rate = await checkAiRateLimitDistributed({
      supabaseAdmin: auth.supabaseAdmin,
      userId: auth.user.id,
    });
    if (rate.allowed === false) {
      await persistAiEvent({
        supabaseAdmin: auth.supabaseAdmin,
        eventType: "mmd_ai_rate_limit",
        userId: auth.user.id,
        errorCode: "AI_RATE_LIMIT",
        messageLength: message.length,
        scope: scopeContext,
      });
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
    const latencyMs = Date.now() - started;
    const usage = response.meta.usage;

    logAiAudit({
      ts: new Date().toISOString(),
      userId: auth.user.id,
      role: auth.aiRole,
      locale: response.message.locale,
      toolsUsed: response.meta.toolsUsed,
      latencyMs,
      escalated: response.meta.escalatedToHuman,
      conversationId: response.conversationId,
      messageLength: message.length,
      ip: getClientIp(req),
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      estimatedCostUsd: usage?.estimatedCostUsd,
      countryCode: scopeContext.countryCode,
      regionCode: scopeContext.regionCode,
      stateCode: scopeContext.stateCode,
    });

    if (usage) {
      await persistAiChatMetrics({
        supabaseAdmin: auth.supabaseAdmin,
        userId: auth.user.id,
        conversationId: response.conversationId,
        userMessage: message,
        assistantMessage: response.message.content,
        scope: scopeContext,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCostUsd: usage.estimatedCostUsd,
          model: usage.model,
        },
        toolsUsed: response.meta.toolsUsed,
        latencyMs,
        escalated: response.meta.escalatedToHuman,
        locale: response.message.locale,
      });
    }

    return aiJson(response);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "MMD AI unavailable";
    const code = msg.includes("OPENAI") ? "OPENAI_ERROR" : "AI_UNAVAILABLE";

    if (authUserId && supabaseAdmin) {
      await persistAiEvent({
        supabaseAdmin,
        eventType: "mmd_ai_error",
        userId: authUserId,
        errorCode: code,
        scope: scopeContext,
      });
    }

    return aiJson({ ok: false, error: msg, code }, 500);
  }
}
