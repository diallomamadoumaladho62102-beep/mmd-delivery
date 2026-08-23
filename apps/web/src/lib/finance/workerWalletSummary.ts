/**
 * WorkerFinance Wallet SoT — single façade for money-out-facing wallet summaries.
 *
 * Role-specific earnings projections may still live in driver / restaurant / seller
 * modules, but Cash Out eligibility always uses the shared Instant funding gate
 * (resolveManualCashoutFunding) inside those builders.
 *
 * API routes must import from this module — not from parallel wallet calculators.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDriverWalletSummary } from "@/lib/driverWalletService";
import {
  buildRestaurantWalletSummary,
  buildSellerWalletSummary,
  type SharedWalletSummary,
} from "@/lib/finance/unifiedWalletSummary";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";
import { resolveManualCashoutFunding } from "@/lib/finance/resolveManualCashoutFunding";

export type WorkerWalletRole = "driver" | "restaurant" | "seller";

export type WorkerWalletSummary = SharedWalletSummary & {
  account_type?: WorkerWalletRole | string;
  money_out_model?: typeof MONEY_OUT_MODEL;
};

/** Shared Instant Cash Out funding probe (Connect SoT). */
export { resolveManualCashoutFunding };

export {
  buildDriverWalletSummary,
  buildRestaurantWalletSummary,
  buildSellerWalletSummary,
};

/**
 * One entrypoint for worker wallet summaries used by Cash Out / Available UI.
 */
export async function buildWorkerWalletSummary(
  supabaseAdmin: SupabaseClient,
  params: {
    role: WorkerWalletRole;
    userId: string;
    countryCode?: string | null;
  },
): Promise<WorkerWalletSummary> {
  const countryCode = params.countryCode ?? "US";
  if (params.role === "driver") {
    const summary = await buildDriverWalletSummary(
      supabaseAdmin,
      params.userId,
      countryCode,
    );
    return {
      ...(summary as unknown as SharedWalletSummary),
      money_out_model: MONEY_OUT_MODEL,
    };
  }
  if (params.role === "restaurant") {
    const summary = await buildRestaurantWalletSummary(
      supabaseAdmin,
      params.userId,
      countryCode,
    );
    return {
      ...summary,
      money_out_model: MONEY_OUT_MODEL,
    };
  }
  const summary = await buildSellerWalletSummary(
    supabaseAdmin,
    params.userId,
    countryCode,
  );
  return {
    ...summary,
    money_out_model: MONEY_OUT_MODEL,
  };
}
