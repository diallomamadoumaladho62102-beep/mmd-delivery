/**
 * Platform bank-payout guard + Stripe schedule enforcement.
 */

import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
export {
  PLATFORM_PAYOUT_GUARD_BLOCK,
  PLATFORM_PAYOUT_GUARD_CLEAR,
  assertPlatformBankPayoutAllowed,
  canFundDriverSctFromPlatformAvailable,
  classifyUnpaidDriverSctStatus,
  evaluatePlatformPayoutGuard,
  type PlatformPayoutGuardState,
} from "@/lib/finance/platformPayoutGuardLogic";

/**
 * Force platform (MMD) Stripe payout schedule to manual so automatic bank
 * payouts cannot drain funds owed to Drivers via SCT.
 */
export async function ensurePlatformManualPayoutSchedule(params?: {
  stripeClient?: Stripe;
  platformAccountId?: string;
}): Promise<
  | {
      ok: true;
      already_manual: boolean;
      interval: string | null;
      platform_account_id: string;
    }
  | { ok: false; error: string; requires_dashboard?: boolean }
> {
  const client = params?.stripeClient ?? stripe;
  try {
    const acct =
      params?.platformAccountId &&
      String(params.platformAccountId).startsWith("acct_")
        ? await client.accounts.retrieve(params.platformAccountId)
        : await client.accounts.retrieve();

    const platformAccountId = String(acct.id ?? "").trim();
    const interval = String(
      acct.settings?.payouts?.schedule?.interval ?? "",
    )
      .trim()
      .toLowerCase();

    if (interval === "manual") {
      return {
        ok: true,
        already_manual: true,
        interval: "manual",
        platform_account_id: platformAccountId,
      };
    }

    await client.accounts.update(platformAccountId, {
      settings: {
        payouts: {
          schedule: {
            interval: "manual",
          },
        },
      },
    });

    const after = await client.accounts.retrieve(platformAccountId);
    const afterInterval = String(
      after.settings?.payouts?.schedule?.interval ?? "",
    )
      .trim()
      .toLowerCase();

    if (afterInterval !== "manual") {
      return {
        ok: false,
        error: "platform_payout_schedule_not_manual_after_update",
        requires_dashboard: true,
      };
    }

    return {
      ok: true,
      already_manual: false,
      interval: "manual",
      platform_account_id: platformAccountId,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: message.slice(0, 400),
      requires_dashboard: true,
    };
  }
}
