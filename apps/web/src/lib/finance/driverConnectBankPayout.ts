/**
 * Connect → bank payout schedule helpers (drivers + restaurants).
 *
 * Product rule:
 * - SCT (platform → Connect): immediate after delivered/completed + paid
 * - Connect → bank (automatic):
 *   - Sunday 04:00 America/New_York primary sweep (full available → ba_*)
 *   - Sunday 16:00 America/New_York catch-up (funds that settled after 04:00)
 * - Manual Instant Cash Out: Instant card or Instant-eligible bank, no $ minimum, 1/day ET
 * - Mid-week available without Instant dest → Instant Cash Out once eligible, else next Sunday
 * - Restaurants + sellers: same Cash Out + Sunday bank rules as drivers
 *
 * Transfer (SCT) is independent of these bank windows — never wait for Sunday to Transfer.
 */

import type Stripe from "stripe";
import { retrieveConnectBalance, stripe } from "@/lib/stripe";

/** IANA zone for founder-requested Sunday bank windows (local New York time). */
export const DRIVER_BANK_PAYOUT_TIMEZONE = "America/New_York";

/** Primary automatic bank sweep hour (America/New_York). */
export const DRIVER_BANK_PAYOUT_PRIMARY_HOUR = 4;
/** Same-day catch-up for funds that became available after the primary sweep. */
export const DRIVER_BANK_PAYOUT_CATCHUP_HOUR = 16;

export type DriverBankPayoutWindowKind = "primary" | "catchup";

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

/**
 * Resolve active Sunday bank window (DST-aware via America/New_York parts).
 * Primary 04:00–04:59 ET and catch-up 16:00–16:59 ET use distinct Stripe idempotency keys
 * so newly available funds after 04:00 can be paid the same Sunday without duplicate po_*.
 */
export function resolveDriverBankPayoutWindow(
  now = new Date(),
):
  | { active: true; kind: DriverBankPayoutWindowKind }
  | { active: false; kind: null } {
  const { weekday, hour } = getNowPartsInTimeZone(
    DRIVER_BANK_PAYOUT_TIMEZONE,
    now,
  );
  if (weekday !== "Sun") return { active: false, kind: null };
  if (hour === DRIVER_BANK_PAYOUT_PRIMARY_HOUR) {
    return { active: true, kind: "primary" };
  }
  if (hour === DRIVER_BANK_PAYOUT_CATCHUP_HOUR) {
    return { active: true, kind: "catchup" };
  }
  return { active: false, kind: null };
}

/** True during Sunday primary (04) or catch-up (16) America/New_York windows. */
export function isDriverBankPayoutWindow(now = new Date()): boolean {
  return resolveDriverBankPayoutWindow(now).active;
}

export function driverBankPayoutIdempotencyKey(
  stripeAccountId: string,
  etDateKey: string,
  kind: DriverBankPayoutWindowKind = "primary",
): string {
  const suffix = kind === "catchup" ? "_catchup" : "";
  return `driver_sunday_bank_payout${suffix}:${stripeAccountId}:${etDateKey}`;
}

/** Same Sunday window / full-available rule for restaurant Connect → bank. */
export function restaurantBankPayoutIdempotencyKey(
  stripeAccountId: string,
  etDateKey: string,
  kind: DriverBankPayoutWindowKind = "primary",
): string {
  const suffix = kind === "catchup" ? "_catchup" : "";
  return `restaurant_sunday_bank_payout${suffix}:${stripeAccountId}:${etDateKey}`;
}

/** Seller Sunday bank payout idempotency (remaining Connect available). */
export function sellerBankPayoutIdempotencyKey(
  stripeAccountId: string,
  etDateKey: string,
  kind: DriverBankPayoutWindowKind = "primary",
): string {
  const suffix = kind === "catchup" ? "_catchup" : "";
  return `seller_sunday_bank_payout${suffix}:${stripeAccountId}:${etDateKey}`;
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
  /** @deprecated prefer recipientUserId */
  driverUserId?: string;
  recipientUserId?: string;
  recipientType?: "driver" | "restaurant" | "seller";
  currency?: string;
  idempotencyKey: string;
  metadata?: Record<string, string>;
}): Promise<
  | { ok: true; payout: Stripe.Payout; amountCents: number; skipped: false }
  | { ok: true; skipped: true; amountCents: 0; reason: string }
  | { ok: false; error: string }
> {
  const stripeAccountId = String(params.stripeAccountId ?? "").trim();
  const currency = String(params.currency ?? "usd").trim().toLowerCase() || "usd";
  const recipientUserId = String(
    params.recipientUserId ?? params.driverUserId ?? "",
  ).trim();
  const recipientType =
    params.recipientType === "restaurant"
      ? "restaurant"
      : params.recipientType === "seller"
        ? "seller"
        : "driver";

  let availableCents = 0;
  try {
    const balance = await retrieveConnectBalance(stripeAccountId);
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

  // Sunday payout must land on a bank account (routing/account), never Instant debit card.
  let bankDestinationId: string | null = null;
  try {
    const banks = await stripe.accounts.listExternalAccounts(stripeAccountId, {
      object: "bank_account",
      limit: 10,
    });
    const preferred =
      (banks.data ?? []).find(
        (row) => String((row as { status?: string }).status ?? "") === "verified",
      ) ?? (banks.data ?? [])[0];
    const id = String((preferred as { id?: string } | undefined)?.id ?? "");
    if (id.startsWith("ba_")) bankDestinationId = id;
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "bank_account_lookup_failed",
    };
  }

  if (!bankDestinationId) {
    return {
      ok: true,
      skipped: true,
      amountCents: 0,
      reason: "no_bank_account_destination",
    };
  }

  try {
    const payout = await stripe.payouts.create(
      {
        amount: availableCents,
        currency,
        // Standard bank payout only — never Instant on Sunday.
        method: "standard",
        destination: bankDestinationId,
        metadata: {
          source:
            recipientType === "restaurant"
              ? "cron_restaurant_sunday_bank_payout"
              : recipientType === "seller"
                ? "cron_seller_sunday_bank_payout"
                : "cron_driver_sunday_bank_payout",
          driver_id: recipientType === "driver" ? recipientUserId : "",
          recipient_user_id: recipientUserId,
          recipient_type: recipientType,
          bank_destination_id: bankDestinationId,
          ...(params.metadata ?? {}),
        },
      },
      {
        stripeAccount: stripeAccountId,
        idempotencyKey: params.idempotencyKey,
      },
    );
    return { ok: true, payout, amountCents: availableCents, skipped: false };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "payout_create_failed",
    };
  }
}
