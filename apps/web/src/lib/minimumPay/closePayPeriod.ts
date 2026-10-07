import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAdjustmentIdempotencyKey,
  computeStandardMinimumPay,
} from "./computeStandardMinimumPay";
import {
  canAutomaticallyTransferMinimumPayKind,
  canCalculateMinimumPay,
  canTransferMinimumPayAdjustments,
  settingsAreCompleteForPeriods,
} from "./engineGate";
import { executeNycMprAdjustmentTransfer } from "./executeNycMprAdjustmentTransfer";
import { tripInConfiguredJurisdiction } from "./nycGeo";
import {
  existingPeriodMustBePreserved,
  nextPeriodWindow,
  periodStartsOnOrAfterEngine,
  resolveOnCallEndedAt,
  shouldCreatePeriodWindow,
} from "./payPeriod";
import {
  loadActivePayRules,
  loadMinimumPaySettings,
  resolvePayRuleForInstant,
} from "./settingsStore";
import type { TimeInterval } from "./types";

function asInterval(startedAt: string, endedAt: string | null, nowMs: number): TimeInterval | null {
  const start = Date.parse(startedAt);
  const end = endedAt ? Date.parse(endedAt) : nowMs;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { startedAtMs: start, endedAtMs: end };
}

async function refreshTripEligibility(
  supabase: SupabaseClient,
  interval: {
    id: string;
    entity_type: string;
    entity_id: string;
  },
  countyCodes: string[]
): Promise<{ eligible: boolean; reason?: string }> {
  let pickupLat: unknown = null;
  let pickupLng: unknown = null;
  let dropoffLat: unknown = null;
  let dropoffLng: unknown = null;

  if (interval.entity_type === "order") {
    const { data } = await supabase
      .from("orders")
      .select(
        "pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, is_test, archived_at, hidden_from_user"
      )
      .eq("id", interval.entity_id)
      .maybeSingle();
    if (
      data?.is_test === true ||
      data?.archived_at ||
      data?.hidden_from_user === true
    ) {
      await supabase
        .from("trip_time_intervals")
        .update({
          eligible: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", interval.id);
      return { eligible: false, reason: "test_or_archived_source" };
    }
    pickupLat = data?.pickup_lat;
    pickupLng = data?.pickup_lng;
    dropoffLat = data?.dropoff_lat;
    dropoffLng = data?.dropoff_lng;
  } else if (interval.entity_type === "delivery_request") {
    const { data } = await supabase
      .from("delivery_requests")
      .select(
        "pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, is_test, archived_at, hidden_from_user"
      )
      .eq("id", interval.entity_id)
      .maybeSingle();
    if (
      data?.is_test === true ||
      data?.archived_at ||
      data?.hidden_from_user === true
    ) {
      await supabase
        .from("trip_time_intervals")
        .update({
          eligible: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", interval.id);
      return { eligible: false, reason: "test_or_archived_source" };
    }
    pickupLat = data?.pickup_lat;
    pickupLng = data?.pickup_lng;
    dropoffLat = data?.dropoff_lat;
    dropoffLng = data?.dropoff_lng;
  } else if (
    interval.entity_type === "taxi_ride" ||
    interval.entity_type === "taxi" ||
    interval.entity_type === "taxi_rides"
  ) {
    const { data } = await supabase
      .from("taxi_rides")
      .select(
        "pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, is_test, archived_at, hidden_from_user"
      )
      .eq("id", interval.entity_id)
      .maybeSingle();
    if (
      data?.is_test === true ||
      data?.archived_at ||
      data?.hidden_from_user === true
    ) {
      await supabase
        .from("trip_time_intervals")
        .update({
          eligible: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", interval.id);
      return { eligible: false, reason: "test_or_archived_source" };
    }
    pickupLat = data?.pickup_lat;
    pickupLng = data?.pickup_lng;
    dropoffLat = data?.dropoff_lat;
    dropoffLng = data?.dropoff_lng;
  } else if (interval.entity_type === "marketplace_job") {
    const { data: job } = await supabase
      .from("marketplace_delivery_jobs")
      .select(
        "pickup_location_id, dropoff_location_id, is_test, archived_at, hidden_from_user, seller_order_id"
      )
      .eq("id", interval.entity_id)
      .maybeSingle();
    let sellerHidden = false;
    if (job?.seller_order_id) {
      const { data: sellerOrder } = await supabase
        .from("seller_orders")
        .select("is_test, archived_at, hidden_from_user")
        .eq("id", job.seller_order_id)
        .maybeSingle();
      sellerHidden =
        sellerOrder?.is_test === true ||
        Boolean(sellerOrder?.archived_at) ||
        sellerOrder?.hidden_from_user === true;
    }
    if (
      job?.is_test === true ||
      job?.archived_at ||
      job?.hidden_from_user === true ||
      sellerHidden
    ) {
      await supabase
        .from("trip_time_intervals")
        .update({
          eligible: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", interval.id);
      return { eligible: false, reason: "test_or_archived_source" };
    }
    const locationIds = [job?.pickup_location_id, job?.dropoff_location_id]
      .map((id) => (id ? String(id) : ""))
      .filter(Boolean);
    if (locationIds.length > 0) {
      const { data: points } = await supabase
        .from("location_points")
        .select("id, pin_lat, pin_lng")
        .in("id", locationIds);
      const byId = new Map(
        (points ?? []).map((row) => [String(row.id), row] as const)
      );
      const pickup = job?.pickup_location_id
        ? byId.get(String(job.pickup_location_id))
        : null;
      const dropoff = job?.dropoff_location_id
        ? byId.get(String(job.dropoff_location_id))
        : null;
      pickupLat = pickup?.pin_lat;
      pickupLng = pickup?.pin_lng;
      dropoffLat = dropoff?.pin_lat;
      dropoffLng = dropoff?.pin_lng;
    }
  }

  const geo = tripInConfiguredJurisdiction({
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    eligibleCountyCodes: countyCodes,
  });
  await supabase
    .from("trip_time_intervals")
    .update({
      pickup_in_scope: geo.pickupInScope,
      dropoff_in_scope: geo.dropoffInScope,
      eligible: geo.eligible,
      updated_at: new Date().toISOString(),
    })
    .eq("id", interval.id);
  return { eligible: geo.eligible };
}

export async function closeDueMinimumPayPeriods(
  supabase: SupabaseClient,
  actor: string
): Promise<Record<string, unknown>> {
  const settings = await loadMinimumPaySettings(supabase);
  if (!settings) return { ok: false, error: "settings_missing" };
  if (!settingsAreCompleteForPeriods(settings)) {
    return { ok: true, skipped: "settings_incomplete" };
  }
  const nowMs = Date.now();
  if (!canCalculateMinimumPay(settings, nowMs)) {
    return { ok: true, skipped: "engine_not_calculating" };
  }

  const jurisdiction = String(settings.defaultJurisdiction ?? "").trim();
  const rules = await loadActivePayRules(supabase, jurisdiction);
  const { data: latestPeriod } = await supabase
    .from("pay_periods")
    .select("ends_at")
    .eq("jurisdiction", jurisdiction)
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const window = nextPeriodWindow({
    settings,
    previousEndsAtIso: latestPeriod?.ends_at ? String(latestPeriod.ends_at) : null,
  });
  if ("error" in window) return { ok: false, error: window.error };
  if (!periodStartsOnOrAfterEngine(settings, window.startsAt)) {
    return { ok: true, skipped: "period_before_engine_start" };
  }

  const rule = resolvePayRuleForInstant(rules, jurisdiction, window.startsAt);
  if (!rule) return { ok: true, skipped: "no_active_rule_for_period" };

  const { data: existingPeriod } = await supabase
    .from("pay_periods")
    .select("id, rule_version_id, status")
    .eq("jurisdiction", jurisdiction)
    .eq("starts_at", window.startsAt)
    .maybeSingle();

  if (
    !existingPeriodMustBePreserved(existingPeriod) &&
    shouldCreatePeriodWindow({
      previousEndsAtIso: latestPeriod?.ends_at ? String(latestPeriod.ends_at) : null,
      windowStartsAtIso: window.startsAt,
      nowMs,
    })
  ) {
    await supabase.from("pay_periods").insert({
      jurisdiction,
      starts_at: window.startsAt,
      ends_at: window.endsAt,
      timezone: settings.timezone,
      method: rule.method,
      rule_version_id: rule.id,
      status: "open",
    });
  }

  const { data: duePeriods, error: dueErr } = await supabase
    .from("pay_periods")
    .select("*")
    .eq("jurisdiction", jurisdiction)
    .in("status", ["scheduled", "open"])
    .lte("ends_at", new Date(nowMs).toISOString());
  if (dueErr) return { ok: false, error: dueErr.message };

  const closed: string[] = [];
  for (const period of duePeriods ?? []) {
    if (!periodStartsOnOrAfterEngine(settings, String(period.starts_at))) continue;
    const result = await reconcileMinimumPayPeriod(supabase, {
      periodId: String(period.id),
      actor,
    });
    if (result.ok) closed.push(String(period.id));
  }

  return { ok: true, closed_period_ids: closed };
}

export async function reconcileMinimumPayPeriod(
  supabase: SupabaseClient,
  input: { periodId: string; actor: string }
): Promise<{ ok: boolean; error?: string; shadowed?: boolean }> {
  const settings = await loadMinimumPaySettings(supabase);
  if (!settings) return { ok: false, error: "settings_missing" };
  const nowMs = Date.now();
  if (!canCalculateMinimumPay(settings, nowMs)) {
    return { ok: false, error: "engine_not_calculating" };
  }

  const { data: period, error: periodErr } = await supabase
    .from("pay_periods")
    .select("*")
    .eq("id", input.periodId)
    .maybeSingle();
  if (periodErr || !period) return { ok: false, error: "period_not_found" };
  if (!periodStartsOnOrAfterEngine(settings, String(period.starts_at))) {
    return { ok: false, error: "period_before_engine_start" };
  }

  const { data: ruleRow } = await supabase
    .from("pay_rule_versions")
    .select("*")
    .eq("id", period.rule_version_id)
    .maybeSingle();
  if (!ruleRow) return { ok: false, error: "rule_not_found" };

  const { data: intervals } = await supabase
    .from("trip_time_intervals")
    .select("id, driver_id, entity_type, entity_id, started_at, ended_at, eligible")
    .lt("started_at", period.ends_at)
    .or(`ended_at.is.null,ended_at.gt.${period.starts_at}`);

  const eligibleById = new Map<string, boolean>();
  for (const row of intervals ?? []) {
    const geo = await refreshTripEligibility(
      supabase,
      {
        id: String(row.id),
        entity_type: String(row.entity_type),
        entity_id: String(row.entity_id),
      },
      settings.eligibleCountyCodes
    );
    eligibleById.set(String(row.id), geo.eligible);
  }

  const { data: sessions } = await supabase
    .from("on_call_sessions")
    .select("driver_id, started_at, ended_at, offer_eligible")
    .lt("started_at", period.ends_at)
    .or(`ended_at.is.null,ended_at.gt.${period.starts_at}`);

  const { data: lines } = await supabase
    .from("earnings_lines")
    .select("driver_id, source_type, amount_cents, counts_toward_mpr, occurred_at")
    .gte("occurred_at", period.starts_at)
    .lt("occurred_at", period.ends_at);

  const driverIds = new Set<string>();
  for (const row of intervals ?? []) driverIds.add(String(row.driver_id));
  for (const row of sessions ?? []) driverIds.add(String(row.driver_id));
  for (const row of lines ?? []) driverIds.add(String(row.driver_id));

  const startMs = Date.parse(String(period.starts_at));
  const endMs = Date.parse(String(period.ends_at));

  const compute = computeStandardMinimumPay({
    config: {
      method: String(ruleRow.method),
      mprCentsPerHour: Math.trunc(Number(ruleRow.mpr_cents_per_hour) || 0),
      rounding: String(ruleRow.rounding),
    },
    periodStartsAtMs: startMs,
    periodEndsAtMs: endMs,
    drivers: [...driverIds].map((driverId) => ({
      driverId,
      tripIntervals: (intervals ?? [])
        .filter((row) => String(row.driver_id) === driverId && eligibleById.get(String(row.id)))
        .map((row) => asInterval(String(row.started_at), row.ended_at ? String(row.ended_at) : null, nowMs))
        .filter((row): row is TimeInterval => Boolean(row)),
      onCallIntervals: (sessions ?? [])
        .filter((row) => String(row.driver_id) === driverId && row.offer_eligible !== false)
        .map((row) =>
          asInterval(
            String(row.started_at),
            resolveOnCallEndedAt(
              String(row.started_at),
              row.ended_at ? String(row.ended_at) : null,
              nowMs,
              settings.onCallStaleAfterSeconds
            ),
            nowMs
          )
        )
        .filter((row): row is TimeInterval => Boolean(row)),
      earnings: (lines ?? [])
        .filter((row) => String(row.driver_id) === driverId)
        .map((row) => ({
          sourceType: String(row.source_type),
          amountCents: Math.trunc(Number(row.amount_cents) || 0),
          countsTowardMpr: row.counts_toward_mpr === true,
        })),
    })),
  });

  const mode = settings.mode;
  const transferAllowed = canTransferMinimumPayAdjustments(settings, nowMs);

  const { data: audit, error: auditErr } = await supabase
    .from("minimum_pay_calculation_audits")
    .insert({
      pay_period_id: period.id,
      driver_id: null,
      mode,
      actor: input.actor,
      inputs: {
        rule_version_id: ruleRow.id,
        mpr_cents_per_hour: ruleRow.mpr_cents_per_hour,
        rounding: ruleRow.rounding,
        method: ruleRow.method,
        period_id: period.id,
        engine_start_at: settings.engineStartAt,
      },
      outputs: compute,
    })
    .select("id")
    .single();
  if (auditErr) return { ok: false, error: auditErr.message };

  for (const driver of compute.drivers) {
    const kinds = [
      {
        kind: "individual" as const,
        required: driver.requiredCents,
        eligible: driver.eligibleCents,
        adjustment: driver.adjustmentCents,
      },
      {
        kind: "fleet_allocation" as const,
        required: compute.requiredAggCents,
        eligible: compute.eligibleAggCents,
        adjustment: driver.fleetAllocationCents,
      },
    ];

    for (const item of kinds) {
      const idempotencyKey = buildAdjustmentIdempotencyKey({
        driverId: driver.driverId,
        payPeriodId: String(period.id),
        ruleVersionId: String(ruleRow.id),
        method: String(ruleRow.method),
        kind: item.kind,
      });

      const { data: existing } = await supabase
        .from("minimum_pay_adjustments")
        .select("id, status, stripe_transfer_id, adjustment_cents")
        .eq("driver_id", driver.driverId)
        .eq("pay_period_id", period.id)
        .eq("rule_version_id", ruleRow.id)
        .eq("kind", item.kind)
        .maybeSingle();

      const frozen =
        existing &&
        (existing.status === "transferred" || existing.status === "transfer_pending");
      if (frozen) continue;

      const automaticTransfer =
        canAutomaticallyTransferMinimumPayKind(item.kind) &&
        item.adjustment > 0 &&
        transferAllowed &&
        mode !== "shadow";

      const status =
        mode === "shadow"
          ? "shadowed"
          : automaticTransfer
            ? "transfer_pending"
            : "computed";

      const { data: saved, error: saveErr } = await supabase
        .from("minimum_pay_adjustments")
        .upsert(
          {
            driver_id: driver.driverId,
            pay_period_id: period.id,
            rule_version_id: ruleRow.id,
            kind: item.kind,
            required_cents: item.required,
            eligible_cents: item.eligible,
            adjustment_cents: item.adjustment,
            status,
            idempotency_key: idempotencyKey,
            calculation_audit_id: audit?.id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "driver_id,pay_period_id,rule_version_id,kind" }
        )
        .select("id")
        .single();
      if (saveErr) return { ok: false, error: saveErr.message };

      if (!automaticTransfer) continue;

      const { data: profile } = await supabase
        .from("driver_profiles")
        .select("stripe_account_id")
        .eq("user_id", driver.driverId)
        .maybeSingle();

      const transfer = await executeNycMprAdjustmentTransfer(supabase, {
        adjustmentId: String(saved?.id ?? ""),
        driverId: driver.driverId,
        amountCents: item.adjustment,
        currency: String(settings.defaultCurrency ?? "").trim(),
        idempotencyKey,
        destinationAccountId: String(profile?.stripe_account_id ?? ""),
        kind: item.kind,
        metadata: {
          pay_period_id: String(period.id),
          kind: item.kind,
        },
      });
      if (transfer.ok && transfer.skipped === false) {
        await supabase
          .from("minimum_pay_adjustments")
          .update({
            status: "transferred",
            stripe_transfer_id: transfer.transferId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", saved?.id);
        await supabase.from("earnings_lines").upsert(
          {
            driver_id: driver.driverId,
            source_type: "nyc_mpr_adjustment",
            source_id: String(saved?.id ?? idempotencyKey),
            amount_cents: item.adjustment,
            currency: String(settings.defaultCurrency ?? "").trim(),
            counts_toward_mpr: false,
            occurred_at: new Date().toISOString(),
          },
          { onConflict: "source_type,source_id" }
        );
      } else if (transfer.ok && transfer.skipped) {
        await supabase
          .from("minimum_pay_adjustments")
          .update({ status: "computed", updated_at: new Date().toISOString() })
          .eq("id", saved?.id);
      } else {
        await supabase
          .from("minimum_pay_adjustments")
          .update({ status: "computed", updated_at: new Date().toISOString() })
          .eq("id", saved?.id);
      }
    }
  }

  await supabase
    .from("pay_periods")
    .update({ status: "reconciled" })
    .eq("id", period.id);

  return { ok: true, shadowed: mode === "shadow" };
}
