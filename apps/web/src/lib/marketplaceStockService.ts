import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { EXPIRE_SAFETY_MARGIN_MS } from "@/lib/expireStalePayments";

/** Stripe Checkout Session default TTL (24h). */
export const MARKETPLACE_CHECKOUT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export async function decrementMarketplaceStockForPaidOrder(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.rpc("mmd_decrement_marketplace_stock", {
    p_seller_order_id: sellerOrderId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function reserveMarketplaceStockForCheckout(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.rpc("mmd_reserve_marketplace_stock", {
    p_seller_order_id: sellerOrderId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

export async function releaseMarketplaceStockReservation(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.rpc("mmd_release_marketplace_stock", {
    p_seller_order_id: sellerOrderId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Idempotent — safe after checkout.session.expired, payment_failed, or cron cleanup. */
export async function releaseMarketplaceStockAfterCheckoutAbandon(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string,
  source: string
): Promise<{ ok: boolean; error?: string }> {
  const result = await releaseMarketplaceStockReservation(supabaseAdmin, sellerOrderId);
  if (!result.ok) {
    console.warn("[marketplace-stock] release after abandon failed", {
      sellerOrderId,
      source,
      error: result.error,
    });
  }
  return result;
}

export type StaleMarketplaceStockReservationRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  stock_reserved_at: string | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

export type ExpireStaleMarketplaceStockSummary = {
  scanned: number;
  released: number;
  skipped_still_open: number;
  skipped_already_paid: number;
  errors: number;
  details: Array<Record<string, unknown>>;
};

export function marketplaceStockReservationCutoffIso(
  nowMs: number,
  marginMs = EXPIRE_SAFETY_MARGIN_MS
): string {
  return new Date(
    nowMs - MARKETPLACE_CHECKOUT_SESSION_TTL_MS - marginMs
  ).toISOString();
}

async function loadStaleMarketplaceStockReservations(
  supabaseAdmin: SupabaseClient,
  cutoffIso: string,
  limit: number
): Promise<StaleMarketplaceStockReservationRow[]> {
  const { data, error } = await supabaseAdmin
    .from("seller_orders")
    .select(
      "id,status,payment_status,stock_reserved_at,stripe_checkout_session_id,stripe_payment_intent_id"
    )
    .not("stock_reserved_at", "is", null)
    .neq("payment_status", "paid")
    .in("status", ["pending_payment", "pending_checkout", "payment_failed"])
    .lt("stock_reserved_at", cutoffIso)
    .limit(limit);

  if (error) throw new Error(`seller_orders_stale_stock_select_failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    status: row.status ?? null,
    payment_status: row.payment_status ?? null,
    stock_reserved_at: row.stock_reserved_at ?? null,
    stripe_checkout_session_id: row.stripe_checkout_session_id ?? null,
    stripe_payment_intent_id: row.stripe_payment_intent_id ?? null,
  }));
}

async function isStripeCheckoutSessionStillOpen(
  stripe: Stripe,
  sessionId: string,
  nowMs: number
): Promise<"open" | "expired" | "paid" | "unknown"> {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid" || session.status === "complete") {
      return "paid";
    }
    if (session.status === "open") {
      const expiresAtMs = Number(session.expires_at ?? 0) * 1000;
      if (Number.isFinite(expiresAtMs) && expiresAtMs > nowMs) {
        return "open";
      }
      return "expired";
    }
    return "expired";
  } catch {
    return "unknown";
  }
}

/**
 * Cron backup for abandoned marketplace checkout stock reservations.
 * Primary path: Stripe `checkout.session.expired` webhook → handleMarketplaceCheckoutSessionExpired.
 */
export async function runExpireStaleMarketplaceStockReservations(opts: {
  supabaseAdmin: SupabaseClient;
  stripe: Stripe | null;
  dryRun?: boolean;
  now?: Date;
  limit?: number;
  abandonCheckout: (
    row: StaleMarketplaceStockReservationRow,
    source: string
  ) => Promise<{ ok: boolean; ignored?: string; error?: string }>;
}): Promise<ExpireStaleMarketplaceStockSummary> {
  const dryRun = opts.dryRun === true;
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const limit = Math.max(0, Math.min(100, Math.floor(Number(opts.limit ?? 50))));
  const cutoffIso = marketplaceStockReservationCutoffIso(nowMs);

  const rows =
    limit === 0
      ? []
      : await loadStaleMarketplaceStockReservations(opts.supabaseAdmin, cutoffIso, limit);

  const summary: ExpireStaleMarketplaceStockSummary = {
    scanned: rows.length,
    released: 0,
    skipped_still_open: 0,
    skipped_already_paid: 0,
    errors: 0,
    details: [],
  };

  for (const row of rows) {
    const detail: Record<string, unknown> = {
      seller_order_id: row.id,
      stock_reserved_at: row.stock_reserved_at,
    };

    try {
      const sessionId = String(row.stripe_checkout_session_id ?? "").trim();
      if (sessionId && opts.stripe) {
        const sessionState = await isStripeCheckoutSessionStillOpen(
          opts.stripe,
          sessionId,
          nowMs
        );
        detail.stripe_session_state = sessionState;
        if (sessionState === "open") {
          summary.skipped_still_open += 1;
          detail.skipped = "checkout_session_still_open";
          summary.details.push(detail);
          continue;
        }
        if (sessionState === "paid") {
          summary.skipped_already_paid += 1;
          detail.skipped = "checkout_session_paid";
          summary.details.push(detail);
          continue;
        }
      }

      if (dryRun) {
        detail.dry_run = true;
        summary.released += 1;
        summary.details.push(detail);
        continue;
      }

      const abandon = await opts.abandonCheckout(
        row,
        "cron:expire-stale-marketplace-stock"
      );
      detail.abandon = abandon;
      if (!abandon.ok) {
        summary.errors += 1;
        if (abandon.error) detail.error = abandon.error;
      } else if (abandon.ignored === "already_paid") {
        summary.skipped_already_paid += 1;
      } else {
        summary.released += 1;
      }
    } catch (error) {
      summary.errors += 1;
      detail.error = error instanceof Error ? error.message : String(error);
      console.error("[marketplace-stock-expiry] row failed", detail);
    }

    summary.details.push(detail);
  }

  return summary;
}
