/**
 * Single SCT entrypoint: credit a confirmed worker earning to Connect.
 * Does not invent funds. Does not create Cash Out / bank payouts (po_*).
 *
 * Money-out stays WorkerFinance only (executeWorkerCashOut / executeWorkerSundayBankPayout).
 *
 * Vertical engines are adapters; this module is the only product-facing SCT dispatcher.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeTaxiDriverFareTransfer } from "@/lib/finance/executeTaxiDriverFareTransfer";
import { invokeOrderConnectTransfer } from "@/lib/finance/orderConnectTransferClient";

export type WorkerEarningRef =
  | { vertical: "taxi"; taxiRideId: string; commissionId?: string }
  | { vertical: "taxi"; commissionId: string; taxiRideId?: string }
  | {
      vertical: "food" | "package";
      orderId: string;
      target: "driver" | "restaurant";
    }
  | { vertical: "marketplace_driver"; payoutId: string }
  | { vertical: "marketplace_seller"; payoutId: string };

export type EnsureWorkerConnectCreditOptions = {
  /** Required for food/package until transfers/run core is fully in-process. */
  orderTransfer?: {
    baseUrl: string;
    authorizationHeader: string;
  };
  actor?: string;
  dryRun?: boolean;
};

export type EnsureWorkerConnectCreditResult =
  | {
      ok: true;
      engine: string;
      transferId: string | null;
      already?: boolean;
      skipped?: boolean;
      description: ReturnType<typeof describeWorkerConnectCredit>;
      detail?: unknown;
    }
  | {
      ok: false;
      engine: string;
      error: string;
      description: ReturnType<typeof describeWorkerConnectCredit>;
      detail?: unknown;
    };

export function describeWorkerConnectCredit(ref: WorkerEarningRef): {
  vertical: string;
  idempotencyHint: string;
  notes: string;
  moneyOutEngine: "workerFinance";
} {
  if (ref.vertical === "taxi") {
    const key = ref.taxiRideId ?? ref.commissionId ?? "unknown";
    return {
      vertical: "taxi",
      idempotencyHint: `taxi_fare_sct:${key}`,
      notes: "executeTaxiDriverFareTransfer (adapter)",
      moneyOutEngine: "workerFinance",
    };
  }
  if (ref.vertical === "food" || ref.vertical === "package") {
    return {
      vertical: ref.vertical,
      idempotencyHint: `transfer:${ref.orderId}:${ref.target}`,
      notes: "orderConnectTransferClient → /api/stripe/transfers/run (adapter)",
      moneyOutEngine: "workerFinance",
    };
  }
  if (ref.vertical === "marketplace_driver") {
    return {
      vertical: "marketplace_driver",
      idempotencyHint: `mkt_driver_payout_${ref.payoutId}`,
      notes: "executeMarketplacePayouts payoutId filter (adapter)",
      moneyOutEngine: "workerFinance",
    };
  }
  if (ref.vertical === "marketplace_seller") {
    return {
      vertical: "marketplace_seller",
      idempotencyHint: `mkt_seller_payout_${ref.payoutId}`,
      notes: "executeMarketplacePayouts payoutId filter (adapter)",
      moneyOutEngine: "workerFinance",
    };
  }
  return {
    vertical: "unknown",
    idempotencyHint: "unknown",
    notes: "unreachable",
    moneyOutEngine: "workerFinance",
  };
}

async function resolveTaxiRideId(
  supabaseAdmin: SupabaseClient,
  ref: Extract<WorkerEarningRef, { vertical: "taxi" }>,
): Promise<string | null> {
  const rideId = String(ref.taxiRideId ?? "").trim();
  if (rideId) return rideId;
  const commissionId = String(ref.commissionId ?? "").trim();
  if (!commissionId) return null;
  const { data, error } = await supabaseAdmin
    .from("taxi_commissions")
    .select("taxi_ride_id")
    .eq("id", commissionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.taxi_ride_id ? String(data.taxi_ride_id) : null;
}

function resolveOrderTransferAuth(
  options?: EnsureWorkerConnectCreditOptions,
): { baseUrl: string; authorizationHeader: string } | null {
  if (options?.orderTransfer?.baseUrl && options.orderTransfer.authorizationHeader) {
    return options.orderTransfer;
  }
  const baseUrl = String(
    process.env.APP_BASE_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      process.env.VERCEL_URL ??
      "",
  )
    .trim()
    .replace(/\/$/, "");
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!baseUrl || !secret) return null;
  const url = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  return {
    baseUrl: url,
    authorizationHeader: `Bearer ${secret}`,
  };
}

/**
 * Credit Connect for one confirmed earning. Server amounts / Connect account /
 * idempotency keys stay inside vertical adapters — never invented here.
 */
export async function ensureWorkerConnectCredit(
  supabaseAdmin: SupabaseClient,
  ref: WorkerEarningRef,
  options?: EnsureWorkerConnectCreditOptions,
): Promise<EnsureWorkerConnectCreditResult> {
  const description = describeWorkerConnectCredit(ref);

  if (ref.vertical === "taxi") {
    const engine = "executeTaxiDriverFareTransfer";
    try {
      const taxiRideId = await resolveTaxiRideId(supabaseAdmin, ref);
      if (!taxiRideId) {
        return {
          ok: false,
          engine,
          error: "taxi_ride_id_or_commission_id_required",
          description,
        };
      }
      const out = await executeTaxiDriverFareTransfer({
        supabaseAdmin,
        taxiRideId,
        dryRun: options?.dryRun === true,
        actor: options?.actor ?? "ensureWorkerConnectCredit",
      });
      if (out.ok === false) {
        return {
          ok: false,
          engine,
          error: String(out.error ?? "taxi_sct_failed"),
          description,
          detail: out,
        };
      }
      const transferId =
        (out as { transfer_id?: string | null; transferId?: string | null })
          .transfer_id ??
        (out as { transferId?: string | null }).transferId ??
        null;
      return {
        ok: true,
        engine,
        transferId: transferId ? String(transferId) : null,
        already: Boolean((out as { already?: boolean }).already),
        description,
        detail: out,
      };
    } catch (e) {
      return {
        ok: false,
        engine,
        error: e instanceof Error ? e.message : String(e),
        description,
      };
    }
  }

  if (ref.vertical === "food" || ref.vertical === "package") {
    const engine = "orderConnectTransferClient";
    const auth = resolveOrderTransferAuth(options);
    if (!auth) {
      return {
        ok: false,
        engine,
        error: "order_transfer_auth_required",
        description,
      };
    }
    try {
      const out = await invokeOrderConnectTransfer({
        baseUrl: auth.baseUrl,
        authorizationHeader: auth.authorizationHeader,
        orderId: ref.orderId,
        target: ref.target,
        dryRun: options?.dryRun === true,
      });
      if (!out.ok) {
        return {
          ok: false,
          engine,
          error: out.error ?? "order_sct_failed",
          description,
          detail: out,
        };
      }
      return {
        ok: true,
        engine,
        transferId: out.transferId,
        already: out.already,
        description,
        detail: out,
      };
    } catch (e) {
      return {
        ok: false,
        engine,
        error: e instanceof Error ? e.message : String(e),
        description,
      };
    }
  }

  if (ref.vertical === "marketplace_driver" || ref.vertical === "marketplace_seller") {
    const engine = "executeMarketplacePayouts";
    try {
      const { executeMarketplacePayouts } = await import(
        "@/lib/marketplacePayoutService"
      );
      const out = await executeMarketplacePayouts(supabaseAdmin, {
        limit: 1,
        payoutId: ref.payoutId,
        role: ref.vertical === "marketplace_driver" ? "driver" : "seller",
      });
      if (out.ok === false) {
        return {
          ok: false,
          engine,
          error: out.error ?? "marketplace_sct_failed",
          description,
          detail: out,
        };
      }
      return {
        ok: true,
        engine,
        transferId: null,
        skipped: Boolean(out.ignored),
        description,
        detail: out,
      };
    } catch (e) {
      return {
        ok: false,
        engine,
        error: e instanceof Error ? e.message : String(e),
        description,
      };
    }
  }

  return {
    ok: false,
    engine: "ensureWorkerConnectCredit",
    error: "unsupported_earning_ref",
    description,
  };
}
