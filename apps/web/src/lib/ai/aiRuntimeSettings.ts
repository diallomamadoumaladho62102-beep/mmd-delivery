import type { SupabaseClient } from "@supabase/supabase-js";

export type AiRuntimeSettingsSnapshot = {
  emergencyStopDb: boolean;
  dailyCostCapUsdDb: number | null;
};

export async function fetchAiRuntimeSettings(
  supabaseAdmin: SupabaseClient
): Promise<AiRuntimeSettingsSnapshot> {
  const { data, error } = await supabaseAdmin
    .from("ai_runtime_settings")
    .select("key, value")
    .in("key", ["emergency_stop", "daily_cost_cap_usd"]);

  if (error) {
    console.error("[aiRuntimeSettings] fetch failed", error.message);
    return { emergencyStopDb: false, dailyCostCapUsdDb: null };
  }

  let emergencyStopDb = false;
  let dailyCostCapUsdDb: number | null = null;

  for (const row of data ?? []) {
    const value = row.value as Record<string, unknown> | null;
    if (row.key === "emergency_stop") {
      emergencyStopDb = Boolean(value?.enabled);
    }
    if (row.key === "daily_cost_cap_usd") {
      const amount = Number(value?.amount);
      dailyCostCapUsdDb = Number.isFinite(amount) && amount > 0 ? amount : null;
    }
  }

  return { emergencyStopDb, dailyCostCapUsdDb };
}

export async function upsertAiRuntimeSetting(params: {
  supabaseAdmin: SupabaseClient;
  key: "emergency_stop" | "daily_cost_cap_usd";
  value: Record<string, unknown>;
  updatedBy: string;
}): Promise<void> {
  const { error } = await params.supabaseAdmin.from("ai_runtime_settings").upsert(
    {
      key: params.key,
      value: params.value,
      updated_at: new Date().toISOString(),
      updated_by: params.updatedBy,
    },
    { onConflict: "key" }
  );

  if (error) {
    throw new Error(error.message);
  }
}
