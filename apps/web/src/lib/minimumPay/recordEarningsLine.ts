import type { SupabaseClient } from "@supabase/supabase-js";
import { sourceCountsTowardMinimum } from "./earningsPolicy";
import {
  canRecordMinimumPayEvents,
  isTimestampOnOrAfterStart,
} from "./engineGate";
import { loadMinimumPaySettings } from "./settingsStore";

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
