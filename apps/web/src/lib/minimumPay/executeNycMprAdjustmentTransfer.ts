import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { canTransferMinimumPayAdjustments } from "./engineGate";
import { loadMinimumPaySettings } from "./settingsStore";

export type NycMprTransferResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; transferId: string; amountCents: number }
  | { ok: false; error: string };

/**
 * Separate platform→Connect transfer. Does not touch delivery SCT or driver_cents.
 * Real money only when Admin mode=active AND transfers_enabled.
 */
export async function executeNycMprAdjustmentTransfer(
  supabase: SupabaseClient,
  input: {
    adjustmentId: string;
    driverId: string;
    amountCents: number;
    currency: string;
    idempotencyKey: string;
    destinationAccountId: string;
    metadata: Record<string, string>;
  }
): Promise<NycMprTransferResult> {
  const settings = await loadMinimumPaySettings(supabase);
  if (!settings) return { ok: true, skipped: true, reason: "settings_missing" };
  if (!canTransferMinimumPayAdjustments(settings, Date.now())) {
    return { ok: true, skipped: true, reason: "transfers_not_enabled" };
  }
  if (input.amountCents <= 0) {
    return { ok: true, skipped: true, reason: "zero_adjustment" };
  }
  if (!String(input.currency ?? "").trim()) {
    return { ok: true, skipped: true, reason: "currency_required" };
  }
  const destination = String(input.destinationAccountId ?? "").trim();
  if (!destination) return { ok: false, error: "connect_account_required" };

  const transfer = await stripe.transfers.create(
    {
      amount: Math.trunc(input.amountCents),
      currency: String(input.currency).trim().toLowerCase(),
      destination,
      metadata: {
        role: "nyc_mpr_adjustment",
        adjustment_id: input.adjustmentId,
        driver_id: input.driverId,
        ...input.metadata,
      },
    },
    { idempotencyKey: input.idempotencyKey }
  );

  return {
    ok: true,
    skipped: false,
    transferId: String(transfer.id),
    amountCents: Math.trunc(input.amountCents),
  };
}
