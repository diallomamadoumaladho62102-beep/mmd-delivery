/**
 * Driver Connect → bank payout schedule helpers.
 *
 * Product rule:
 * - SCT (fare) → Connect: immediate after ride complete
 * - Connect → bank: Sunday 04:00 America/New_York, full available balance, no $20 minimum
 * - Manual MMD Cash Out may keep its own $20 minimum (separate path)
 */

import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";

/** IANA zone for founder-requested Sunday 4:00 local New York time. */
export const DRIVER_BANK_PAYOUT_TIMEZONE = "America/New_York";

export function getNowPartsInTimeZone(
  timeZone: string,
  now = new Date(),
): { weekday: string; hour: number; dateKey: string } {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(now),
  );
  const dateKey = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // YYYY-MM-DD
  return { weekday, hour, dateKey };
}

/** True during Sunday 03:00–04:59 America/New_York (DST-aware).
 * Vercel Hobby allows only one cron fire/day; schedule is Sunday 08:00 UTC:
 * - EDT (UTC-4): 08:00 UTC = 04:00 ET (exact target)
 * - EST (UTC-5): 08:00 UTC = 03:00 ET (one hour early in winter)
 */
export function isDriverBankPayoutWindow(now = new Date()): boolean {
  const { weekday, hour } = getNowPartsInTimeZone(
    DRIVER_BANK_PAYOUT_TIMEZONE,
    now,
  );
  return weekday === "Sun" && (hour === 3 || hour === 4);
}

export function driverBankPayoutIdempotencyKey(
  stripeAccountId: string,
  etDateKey: string,
): string {
  return `driver_sunday_bank_payout:${stripeAccountId}:${etDateKey}`;
}

/**
 * Force Express auto-payouts OFF so bank payouts are driven by MMD Sunday cron
 * (or explicit manual Cash Out), not Stripe daily defaults.
 */
export async function ensureDriverConnectManualPayoutSchedule(
  stripeAccountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = String(stripeAccountId ?? "").trim();
  if (!id.startsWith("acct_")) {
    return { ok: false, error: "invalid_stripe_account_id" };
  }
  try {
    await stripe.accounts.update(id, {
      settings: {
        payouts: {
          schedule: {
            interval: "manual",
          },
        },
      },
    });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "accounts_update_failed",
    };
  }
}

export async function createFullAvailableConnectPayout(params: {
  stripeAccountId: string;
  driverUserId: string;
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}): Promise<
  | { ok: true; payout: Stripe.Payout; amountCents: number; skipped?: false }
  | { ok: true; skipped: true; amountCents: 0; reason: string }
  | { ok: false; error: string }
> {
  const stripeAccountId = String(params.stripeAccountId ?? "").trim();
  const currency = String(params.currency ?? "usd").trim().toLowerCase() || "usd";

  let availableCents = 0;
  try {
    const balance = await stripe.balance.retrieve({
      stripeAccount: stripeAccountId,
    });
    availableCents = (balance.available ?? [])
      .filter((row) => String(row.currency ?? "").toLowerCase() === currency)
      .reduce(
        (sum, row) => sum + Math.max(0, Math.round(Number(row.amount ?? 0))),
        0,
      );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "balance_retrieve_failed",
    };
  }

  if (availableCents <= 0) {
    return {
      ok: true,
      skipped: true,
      amountCents: 0,
      reason: "zero_available_balance",
    };
  }

  try {
    const payout = await stripe.payouts.create(
      {
        amount: availableCents,
        currency,
        metadata: {
          source: "cron_driver_sunday_bank_payout",
          driver_id: params.driverUserId,
          ...(params.metadata ?? {}),
        },
      },
      {
        stripeAccount: stripeAccountId,
        idempotencyKey: params.idempotencyKey,
      },
    );
    return { ok: true, payout, amountCents: availableCents };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "payout_create_failed",
    };
  }
}
