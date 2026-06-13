import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getAiRateLimitMaxPerUser,
  getAiRateLimitWindowMs,
  shouldUseSupabaseAiRateLimit,
} from "@/lib/ai/aiConfig";
import { checkAiRateLimit as checkAiRateLimitMemory } from "@/lib/ai/aiRateLimit";

export async function checkAiRateLimitDistributed(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
}): Promise<{ allowed: true } | { allowed: false; retryAfter: number }> {
  if (!shouldUseSupabaseAiRateLimit()) {
    return checkAiRateLimitMemory(params.userId);
  }

  const windowMs = getAiRateLimitWindowMs();
  const max = getAiRateLimitMaxPerUser();

  const { data, error } = await params.supabaseAdmin.rpc("check_ai_rate_limit", {
    p_user_id: params.userId,
    p_window_ms: windowMs,
    p_max_hits: max,
  });

  if (error) {
    console.error("[aiRateLimit] supabase rpc failed, falling back to memory", error.message);
    return checkAiRateLimitMemory(params.userId);
  }

  const payload = (data ?? {}) as { allowed?: boolean; retry_after?: number | null };
  if (payload.allowed === false) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Number(payload.retry_after ?? 60)),
    };
  }

  return { allowed: true };
}
