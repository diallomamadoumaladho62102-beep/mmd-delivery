import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpenAiUsageTotals } from "@/lib/ai/aiOpenAiPricing";
import { classifyAiIntent } from "@/lib/ai/aiIntent";
import { logAiStructured, type AiStructuredEventType } from "@/lib/ai/aiStructuredLog";
import type { AiScopeContext } from "@/lib/ai/aiScopeGate";

export type PersistAiChatMetricsInput = {
  supabaseAdmin: SupabaseClient;
  userId: string;
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  scope: AiScopeContext;
  usage: OpenAiUsageTotals;
  toolsUsed: string[];
  latencyMs: number;
  escalated: boolean;
  locale: string;
};

export type PersistAiEventInput = {
  supabaseAdmin: SupabaseClient;
  eventType: AiStructuredEventType;
  userId?: string;
  conversationId?: string;
  errorCode?: string;
  messageLength?: number;
  latencyMs?: number;
  toolsUsed?: string[];
  usage?: OpenAiUsageTotals;
  scope?: Pick<AiScopeContext, "countryCode" | "regionCode" | "stateCode">;
  intent?: string;
  escalated?: boolean;
  locale?: string;
};

async function upsertConversation(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  conversationId: string;
  scope: AiScopeContext;
  intent: string;
  escalated: boolean;
  usage: OpenAiUsageTotals;
}): Promise<string | null> {
  const now = new Date().toISOString();
  const { data: existing } = await params.supabaseAdmin
    .from("ai_conversations")
    .select("id, message_count, total_prompt_tokens, total_completion_tokens, estimated_cost_usd, escalated")
    .eq("conversation_id", params.conversationId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (existing?.id) {
    const { data: updated, error } = await params.supabaseAdmin
      .from("ai_conversations")
      .update({
        last_message_at: now,
        message_count: Number(existing.message_count ?? 0) + 2,
        intent_primary: params.intent,
        escalated: Boolean(existing.escalated) || params.escalated,
        total_prompt_tokens:
          Number(existing.total_prompt_tokens ?? 0) + params.usage.promptTokens,
        total_completion_tokens:
          Number(existing.total_completion_tokens ?? 0) + params.usage.completionTokens,
        estimated_cost_usd:
          Number(existing.estimated_cost_usd ?? 0) + params.usage.estimatedCostUsd,
        country_code: params.scope.countryCode,
        region_code: params.scope.regionCode,
        state_code: params.scope.stateCode,
        scope_level: params.scope.scope.scope_level,
        scope_source: params.scope.scope.scope_source,
      })
      .eq("id", existing.id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[aiMetrics] conversation update failed", error.message);
      return null;
    }
    return updated?.id ?? existing.id;
  }

  const { data: inserted, error } = await params.supabaseAdmin
    .from("ai_conversations")
    .insert({
      conversation_id: params.conversationId,
      user_id: params.userId,
      country_code: params.scope.countryCode,
      region_code: params.scope.regionCode,
      state_code: params.scope.stateCode,
      scope_level: params.scope.scope.scope_level,
      scope_source: params.scope.scope.scope_source,
      intent_primary: params.intent,
      escalated: params.escalated,
      message_count: 2,
      total_prompt_tokens: params.usage.promptTokens,
      total_completion_tokens: params.usage.completionTokens,
      estimated_cost_usd: params.usage.estimatedCostUsd,
      started_at: now,
      last_message_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[aiMetrics] conversation insert failed", error.message);
    return null;
  }
  return inserted?.id ?? null;
}

export async function persistAiChatMetrics(input: PersistAiChatMetricsInput): Promise<void> {
  const intent = classifyAiIntent(input.userMessage, input.toolsUsed);
  const conversationRowId = await upsertConversation({
    supabaseAdmin: input.supabaseAdmin,
    userId: input.userId,
    conversationId: input.conversationId,
    scope: input.scope,
    intent,
    escalated: input.escalated,
    usage: input.usage,
  });

  const geo = {
    country_code: input.scope.countryCode,
    region_code: input.scope.regionCode,
    state_code: input.scope.stateCode,
  };

  const rows = [
    {
      conversation_row_id: conversationRowId,
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: "user",
      message_length: input.userMessage.length,
      intent,
      ...geo,
    },
    {
      conversation_row_id: conversationRowId,
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: "assistant",
      message_length: input.assistantMessage.length,
      prompt_tokens: input.usage.promptTokens,
      completion_tokens: input.usage.completionTokens,
      total_tokens: input.usage.totalTokens,
      estimated_cost_usd: input.usage.estimatedCostUsd,
      model: input.usage.model,
      tools_used: input.toolsUsed,
      latency_ms: input.latencyMs,
      intent,
      ...geo,
    },
  ];

  if (conversationRowId) {
    const { error } = await input.supabaseAdmin.from("ai_messages").insert(rows);
    if (error) {
      console.error("[aiMetrics] messages insert failed", error.message);
    }
  }

  await persistAiEvent({
    supabaseAdmin: input.supabaseAdmin,
    eventType: "mmd_ai_chat",
    userId: input.userId,
    conversationId: input.conversationId,
    messageLength: input.userMessage.length,
    latencyMs: input.latencyMs,
    toolsUsed: input.toolsUsed,
    usage: input.usage,
    scope: input.scope,
    intent,
    escalated: input.escalated,
    locale: input.locale,
  });

  if (input.escalated) {
    await persistAiEvent({
      supabaseAdmin: input.supabaseAdmin,
      eventType: "mmd_ai_escalation",
      userId: input.userId,
      conversationId: input.conversationId,
      scope: input.scope,
      intent,
    });
  }
}

export async function persistAiEvent(input: PersistAiEventInput): Promise<void> {
  logAiStructured({
    event: input.eventType,
    ts: new Date().toISOString(),
    userId: input.userId,
    conversationId: input.conversationId,
    errorCode: input.errorCode,
    messageLength: input.messageLength,
    latencyMs: input.latencyMs,
    toolsUsed: input.toolsUsed,
    promptTokens: input.usage?.promptTokens,
    completionTokens: input.usage?.completionTokens,
    estimatedCostUsd: input.usage?.estimatedCostUsd,
    countryCode: input.scope?.countryCode,
    regionCode: input.scope?.regionCode,
    stateCode: input.scope?.stateCode,
    intent: input.intent,
    escalated: input.escalated,
    locale: input.locale,
  });

  try {
    await input.supabaseAdmin.from("ai_events").insert({
      event_type: input.eventType,
      user_id: input.userId ?? null,
      conversation_id: input.conversationId ?? null,
      error_code: input.errorCode ?? null,
      message_length: input.messageLength ?? null,
      latency_ms: input.latencyMs ?? null,
      tools_used: input.toolsUsed ?? [],
      prompt_tokens: input.usage?.promptTokens ?? 0,
      completion_tokens: input.usage?.completionTokens ?? 0,
      estimated_cost_usd: input.usage?.estimatedCostUsd ?? 0,
      country_code: input.scope?.countryCode ?? null,
      region_code: input.scope?.regionCode ?? null,
      state_code: input.scope?.stateCode ?? null,
      intent: input.intent ?? null,
    });
  } catch (err) {
    console.error("[aiMetrics] event insert failed", err);
  }
}
