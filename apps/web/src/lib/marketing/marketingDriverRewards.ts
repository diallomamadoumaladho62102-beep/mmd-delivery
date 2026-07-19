import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyMarketingClient } from "@/lib/marketing/marketingNotifications";

export async function processDriverMarketingObjectivesBatch(
  supabaseAdmin: SupabaseClient,
  limit = 100
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(
    "mmd_marketing_process_driver_objectives_batch",
    { p_limit: Math.max(1, Math.min(limit, 500)) }
  );
  if (error) return { ok: false, error: error.message };
  return (data ?? {}) as Record<string, unknown>;
}

export async function payDriverMarketingProgress(
  supabaseAdmin: SupabaseClient,
  params: {
    progressId: string;
    idempotencyKey?: string | null;
    countryCode?: string | null;
    notify?: boolean;
  }
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(
    "mmd_marketing_pay_driver_progress",
    {
      p_progress_id: params.progressId,
      p_idempotency_key: params.idempotencyKey ?? null,
      p_country_code: params.countryCode ?? "US",
    }
  );
  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as Record<string, unknown>;

  if (params.notify !== false && result.ok && result.rewarded) {
    const { data: prog } = await supabaseAdmin
      .from("marketing_driver_progress")
      .select("driver_user_id")
      .eq("id", params.progressId)
      .maybeSingle();
    if (prog?.driver_user_id) {
      await notifyMarketingClient({
        supabaseAdmin,
        userId: String(prog.driver_user_id),
        title: "Bonus campagne versé",
        body: "Votre objectif chauffeur a été atteint. Le bonus a été crédité sur votre wallet.",
        event: "driver_reward_paid",
      });
    }
  }

  return result;
}

export async function reverseDriverMarketingProgress(
  supabaseAdmin: SupabaseClient,
  params: {
    progressId: string;
    reason?: string | null;
    idempotencyKey?: string | null;
    notify?: boolean;
  }
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(
    "mmd_marketing_reverse_driver_progress",
    {
      p_progress_id: params.progressId,
      p_reason: params.reason ?? null,
      p_idempotency_key: params.idempotencyKey ?? null,
    }
  );
  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as Record<string, unknown>;

  if (params.notify !== false && result.ok && result.reversed) {
    const { data: prog } = await supabaseAdmin
      .from("marketing_driver_progress")
      .select("driver_user_id")
      .eq("id", params.progressId)
      .maybeSingle();
    if (prog?.driver_user_id) {
      await notifyMarketingClient({
        supabaseAdmin,
        userId: String(prog.driver_user_id),
        title: "Bonus campagne repris",
        body: "Un bonus campagne a été repris. Consultez le détail dans votre wallet.",
        event: "driver_reward_reversed",
      });
    }
  }

  return result;
}
