/**
 * MMD Worker Finance — SINGLE money-out engine.
 *
 * Confirmed earning → Connect (SCT) → Worker Wallet
 *   ├── Cash Out: Instant po_* → Instant card or Instant bank (executeWorkerCashOut)
 *   └── Sunday 04:00 ET: standard po_* → bank (executeWorkerSundayBankPayout)
 *
 * Only two modules may call stripe.payouts.create (enforced by regression test):
 *   - manualCashoutService.ts
 *   - driverConnectBankPayout.ts
 *
 * SCT (tr_*) is never a worker bank/card Cash Out.
 * Create → processing; Paid only after Stripe payout.paid / reconcile.
 * Legacy Edge pay-driver-now / process_driver_payouts are permanently disabled.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  createFullAvailableConnectPayout,
  ensureDriverConnectManualPayoutSchedule,
} from "@/lib/finance/driverConnectBankPayout";
import {
  executeManualConnectCashout,
  type ManualCashoutRecipientType,
  type ManualCashoutResult,
} from "@/lib/finance/manualCashoutService";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";

export const WORKER_FINANCE_MODEL = MONEY_OUT_MODEL;

export const WORKER_FINANCE_PAYOUT_CREATE_ALLOWLIST = [
  "apps/web/src/lib/finance/manualCashoutService.ts",
  "apps/web/src/lib/finance/driverConnectBankPayout.ts",
] as const;

export const WORKER_BANK_PAYOUT_METHOD_CODES = [
  "payout_stripe_connect_instant",
  "payout_stripe_connect_sunday",
] as const;

export const CONNECT_INTERNAL_TRANSFER_METHOD_CODE =
  "connect_internal_transfer" as const;

export type WorkerCashOutParams = {
  supabaseAdmin: SupabaseClient;
  recipientType: ManualCashoutRecipientType;
  recipientUserId: string;
  currency?: string;
  source?: string;
};

/** Manual Cash Out — Instant only, 100% Instant-eligible, no client amount. */
export async function executeWorkerCashOut(
  params: WorkerCashOutParams,
): Promise<ManualCashoutResult> {
  return executeManualConnectCashout(params);
}

/** Sunday bank payout — standard → ba_* only. */
export async function executeWorkerSundayBankPayout(params: {
  stripeAccountId: string;
  recipientUserId?: string;
  driverUserId?: string;
  recipientType?: "driver" | "restaurant" | "seller";
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}): Promise<
  | { ok: true; payout: Stripe.Payout; amountCents: number; skipped: false }
  | { ok: true; skipped: true; amountCents: 0; reason: string }
  | { ok: false; error: string }
> {
  return createFullAvailableConnectPayout(params);
}

/** Keep Connect auto-payouts Manual so only WorkerFinance moves money out. */
export async function lockWorkerConnectManualPayoutSchedule(
  stripeAccountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return ensureDriverConnectManualPayoutSchedule(stripeAccountId);
}

export function isWorkerBankPayoutExternalRef(
  externalReference: string | null | undefined,
): boolean {
  return String(externalReference ?? "")
    .trim()
    .startsWith("po_");
}

export function isConnectInternalTransferRef(
  externalReference: string | null | undefined,
): boolean {
  return String(externalReference ?? "")
    .trim()
    .startsWith("tr_");
}
