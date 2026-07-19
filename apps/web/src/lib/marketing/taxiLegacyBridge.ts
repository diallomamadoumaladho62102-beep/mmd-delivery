import type { SupabaseClient } from "@supabase/supabase-js";

export async function bridgeTaxiLegacyPromotions(
  supabaseAdmin: SupabaseClient,
  params?: { dryRun?: boolean; limit?: number }
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc(
    "mmd_marketing_bridge_taxi_promotions",
    {
      p_dry_run: params?.dryRun !== false,
      p_limit: Math.max(1, Math.min(params?.limit ?? 200, 1000)),
    }
  );
  if (error) return { ok: false, error: error.message };
  return (data ?? {}) as Record<string, unknown>;
}
