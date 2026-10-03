import type { SupabaseClient } from "@supabase/supabase-js";
import { executeNycMprAdjustmentTransfer } from "./executeNycMprAdjustmentTransfer";
import { canTransferMinimumPayAdjustments } from "./engineGate";
import { loadMinimumPaySettings } from "./settingsStore";

export type ApproveFleetAllocationResult =
  | {
      ok: true;
      skipped: false;
      transferId: string;
      amountCents: number;
      adjustmentId: string;
    }
  | { ok: true; skipped: true; reason: string; transferId?: string }
  | { ok: false; error: string };

function asTrimmed(value: unknown): string {
  return String(value ?? "").trim();
}

export async function approveFleetAllocationTransfer(
  supabase: SupabaseClient,
  input: {
    adjustmentId: string;
    actorUserId: string;
    actor: string;
  }
): Promise<ApproveFleetAllocationResult> {
  const adjustmentId = asTrimmed(input.adjustmentId);
  if (!adjustmentId) return { ok: false, error: "adjustment_not_found" };

  const settings = await loadMinimumPaySettings(supabase);
  if (!settings) return { ok: false, error: "settings_missing" };
  if (!canTransferMinimumPayAdjustments(settings, Date.now())) {
    return { ok: false, error: "transfers_not_enabled" };
  }

  const { data: row, error: loadErr } = await supabase
    .from("minimum_pay_adjustments")
    .select(
      "id, driver_id, pay_period_id, rule_version_id, kind, required_cents, eligible_cents, adjustment_cents, status, stripe_transfer_id, idempotency_key"
    )
    .eq("id", adjustmentId)
    .maybeSingle();
  if (loadErr) return { ok: false, error: loadErr.message };
  if (!row) return { ok: false, error: "adjustment_not_found" };
  if (asTrimmed(row.kind) !== "fleet_allocation") {
    return { ok: false, error: "not_fleet_allocation" };
  }

  const amountCents = Math.trunc(Number(row.adjustment_cents) || 0);
  if (amountCents <= 0) return { ok: false, error: "zero_adjustment" };

  if (asTrimmed(row.status) === "transferred" || asTrimmed(row.stripe_transfer_id)) {
    return {
      ok: true,
      skipped: true,
      reason: "already_transferred",
      transferId: asTrimmed(row.stripe_transfer_id) || undefined,
    };
  }
  if (asTrimmed(row.status) === "transfer_pending") {
    return { ok: false, error: "transfer_already_pending" };
  }
  if (asTrimmed(row.status) === "shadowed") {
    return { ok: false, error: "shadow_adjustment" };
  }
  if (asTrimmed(row.status) !== "computed") {
    return { ok: false, error: "not_pending_approval" };
  }

  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimErr } = await supabase
    .from("minimum_pay_adjustments")
    .update({ status: "transfer_pending", updated_at: claimedAt })
    .eq("id", row.id)
    .eq("kind", "fleet_allocation")
    .eq("status", "computed")
    .is("stripe_transfer_id", null)
    .select("id")
    .maybeSingle();
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed) return { ok: false, error: "approval_conflict" };

  await supabase.from("minimum_pay_calculation_audits").insert({
    pay_period_id: row.pay_period_id,
    driver_id: row.driver_id,
    mode: settings.mode,
    actor: input.actor,
    inputs: {
      action: "approve_fleet_allocation",
      adjustment_id: row.id,
      driver_id: row.driver_id,
      pay_period_id: row.pay_period_id,
      kind: row.kind,
      required_cents: row.required_cents,
      eligible_cents: row.eligible_cents,
      original_adjustment_cents: row.adjustment_cents,
      approved_by: input.actorUserId,
      approved_at: claimedAt,
    },
    outputs: {
      status: "transfer_pending",
      amount_cents: amountCents,
    },
  });

  const { data: profile } = await supabase
    .from("driver_profiles")
    .select("stripe_account_id")
    .eq("user_id", row.driver_id)
    .maybeSingle();

  const transfer = await executeNycMprAdjustmentTransfer(supabase, {
    adjustmentId: String(row.id),
    driverId: String(row.driver_id),
    amountCents,
    currency: String(settings.defaultCurrency ?? "").trim(),
    idempotencyKey: String(row.idempotency_key),
    destinationAccountId: String(profile?.stripe_account_id ?? ""),
    kind: "fleet_allocation",
    manualFleetApproval: true,
    metadata: {
      pay_period_id: String(row.pay_period_id),
      kind: "fleet_allocation",
      approved_by: input.actorUserId,
    },
  });

  if (transfer.ok && transfer.skipped === false) {
    const transferredAt = new Date().toISOString();
    await supabase
      .from("minimum_pay_adjustments")
      .update({
        status: "transferred",
        stripe_transfer_id: transfer.transferId,
        updated_at: transferredAt,
      })
      .eq("id", row.id);
    await supabase.from("earnings_lines").upsert(
      {
        driver_id: row.driver_id,
        source_type: "nyc_mpr_adjustment",
        source_id: String(row.id),
        amount_cents: amountCents,
        currency: String(settings.defaultCurrency ?? "").trim(),
        counts_toward_mpr: false,
        occurred_at: transferredAt,
      },
      { onConflict: "source_type,source_id" }
    );
    await supabase.from("minimum_pay_calculation_audits").insert({
      pay_period_id: row.pay_period_id,
      driver_id: row.driver_id,
      mode: settings.mode,
      actor: input.actor,
      inputs: {
        action: "fleet_allocation_transferred",
        adjustment_id: row.id,
        approved_by: input.actorUserId,
        original_adjustment_cents: amountCents,
      },
      outputs: {
        status: "transferred",
        stripe_transfer_id: transfer.transferId,
        transferred_at: transferredAt,
      },
    });
    return {
      ok: true,
      skipped: false,
      transferId: transfer.transferId,
      amountCents,
      adjustmentId: String(row.id),
    };
  }

  const failure = transfer.ok
    ? transfer.reason
    : transfer.error;
  await supabase
    .from("minimum_pay_adjustments")
    .update({ status: "computed", updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "transfer_pending");
  await supabase.from("minimum_pay_calculation_audits").insert({
    pay_period_id: row.pay_period_id,
    driver_id: row.driver_id,
    mode: settings.mode,
    actor: input.actor,
    inputs: {
      action: "fleet_allocation_transfer_failed",
      adjustment_id: row.id,
      approved_by: input.actorUserId,
      original_adjustment_cents: amountCents,
    },
    outputs: {
      status: "computed",
      error: failure,
    },
  });
  return { ok: false, error: failure || "approval_failed" };
}
