import type { SupabaseClient } from "@supabase/supabase-js";
import { sourceCountsTowardMinimum } from "./earningsPolicy";
import {
  canRecordMinimumPayEvents,
  isTimestampOnOrAfterStart,
} from "./engineGate";
import { loadMinimumPaySettings } from "./settingsStore";

async function skipTestFinancialSource(
  supabase: SupabaseClient,
  sourceType: string,
  sourceId: string
): Promise<string | null> {
  const id = String(sourceId ?? "").trim();
  if (!id) return "source_id_required";
  const kind = String(sourceType ?? "").trim();
  const table =
    kind === "delivery_share" || kind === "food_order" || kind === "order"
      ? "orders"
      : kind === "delivery_request" || kind === "package"
        ? "delivery_requests"
    : kind === "taxi" || kind === "taxi_ride"
      ? "taxi_rides"
      : kind === "marketplace_job" || kind === "marketplace_delivery_job"
        ? "marketplace_delivery_jobs"
        : kind === "seller_order"
          ? "seller_orders"
          : null;
  if (!table) return null;
  const { data } = await supabase
    .from(table)
    .select("is_test, archived_at, hidden_from_user")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  if (data.is_test === true) return "test_source_excluded";
  if (data.archived_at) return "archived_source_excluded";
  if (data.hidden_from_user === true) return "hidden_source_excluded";
  return null;
}

export async function recordMinimumPayEarningsLine(
  supabase: SupabaseClient,
  input: {
    driverId: string;
    sourceType: string;
    sourceId: string;
    amountCents: number;
    currency?: string;
    occurredAt?: string;
  }
): Promise<{ ok: boolean; skipped?: string }> {
  const settings = await loadMinimumPaySettings(supabase);
  if (!settings) return { ok: true, skipped: "settings_missing" };
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const nowMs = Date.now();
  if (!canRecordMinimumPayEvents(settings, nowMs)) {
    return { ok: true, skipped: "engine_not_recording" };
  }
  if (!isTimestampOnOrAfterStart(settings, occurredAt)) {
    return { ok: true, skipped: "before_engine_start" };
  }
  const testSkip = await skipTestFinancialSource(
    supabase,
    input.sourceType,
    input.sourceId
  );
  if (testSkip) return { ok: true, skipped: testSkip };

  const currency = String(input.currency ?? settings.defaultCurrency ?? "")
    .trim()
    .toUpperCase();
  if (!currency) return { ok: true, skipped: "currency_required" };

  const counts = sourceCountsTowardMinimum({
    sourceType: input.sourceType,
    settings,
  });

  const { error } = await supabase.from("earnings_lines").upsert(
    {
      driver_id: input.driverId,
      source_type: input.sourceType,
      source_id: input.sourceId,
      amount_cents: Math.trunc(input.amountCents),
      currency,
      counts_toward_mpr: counts,
      occurred_at: occurredAt,
    },
    { onConflict: "source_type,source_id" }
  );
  if (error) return { ok: false, skipped: error.message };
  return { ok: true };
}
