import type { SupabaseClient } from "@supabase/supabase-js";

export type SellerWalletActivityItem = {
  id: string;
  kind: "payout" | "wallet_entry" | "refund";
  status: string;
  amount_cents: number;
  currency: string;
  direction: "credit" | "debit";
  title: string;
  subtitle: string | null;
  seller_order_id: string | null;
  stripe_transfer_id: string | null;
  stripe_refund_id: string | null;
  platform_fee_cents: number | null;
  created_at: string;
};

/**
 * Unified seller money activity: payouts, wallet entries, and refunded orders.
 */
export async function listSellerWalletActivity(
  supabaseAdmin: SupabaseClient,
  sellerUserId: string,
  limit = 50
): Promise<SellerWalletActivityItem[]> {
  const { data: sellers, error: sellerErr } = await supabaseAdmin
    .from("sellers")
    .select("id")
    .eq("user_id", sellerUserId)
    .limit(20);

  if (sellerErr) throw new Error(sellerErr.message);
  const sellerIds = (sellers ?? [])
    .map((s) => String((s as { id?: string }).id ?? "").trim())
    .filter(Boolean);
  if (sellerIds.length === 0) return [];

  const [payoutsRes, entriesRes, refundsRes] = await Promise.all([
    supabaseAdmin
      .from("marketplace_seller_payouts")
      .select(
        "id,seller_order_id,gross_amount_cents,platform_fee_cents,seller_net_amount_cents,currency,status,stripe_transfer_id,created_at,updated_at"
      )
      .in("seller_id", sellerIds)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("marketplace_seller_wallet_entries")
      .select(
        "id,seller_id,seller_order_id,amount_cents,currency,entry_type,status,metadata,created_at"
      )
      .in("seller_id", sellerIds)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("seller_orders")
      .select(
        "id,total_cents,currency,refund_status,stripe_refund_id,stripe_refunded_at,updated_at,created_at"
      )
      .in("seller_id", sellerIds)
      .in("refund_status", ["refunded", "partially_refunded", "full_refund_required", "refund_failed"])
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);

  if (payoutsRes.error && payoutsRes.error.code !== "42P01") {
    throw new Error(payoutsRes.error.message);
  }
  if (entriesRes.error && entriesRes.error.code !== "42P01") {
    throw new Error(entriesRes.error.message);
  }
  if (refundsRes.error && refundsRes.error.code !== "42P01") {
    throw new Error(refundsRes.error.message);
  }

  const items: SellerWalletActivityItem[] = [];

  for (const row of payoutsRes.data ?? []) {
    const status = String(row.status ?? "pending").toLowerCase();
    items.push({
      id: `payout_${row.id}`,
      kind: "payout",
      status,
      amount_cents: Math.max(0, Math.round(Number(row.seller_net_amount_cents ?? 0))),
      currency: String(row.currency ?? "USD"),
      direction: "credit",
      title: "Seller payout",
      subtitle: `Gross ${Math.round(Number(row.gross_amount_cents ?? 0))} · fee ${Math.round(Number(row.platform_fee_cents ?? 0))}`,
      seller_order_id: row.seller_order_id ? String(row.seller_order_id) : null,
      stripe_transfer_id: row.stripe_transfer_id
        ? String(row.stripe_transfer_id)
        : null,
      stripe_refund_id: null,
      platform_fee_cents: Math.round(Number(row.platform_fee_cents ?? 0)),
      created_at: String(row.updated_at ?? row.created_at),
    });
  }

  for (const row of entriesRes.data ?? []) {
    items.push({
      id: `entry_${row.id}`,
      kind: "wallet_entry",
      status: String(row.status ?? "posted"),
      amount_cents: Math.max(0, Math.round(Number(row.amount_cents ?? 0))),
      currency: String(row.currency ?? "USD"),
      direction: "credit",
      title: String(row.entry_type ?? "wallet_entry"),
      subtitle: null,
      seller_order_id: row.seller_order_id ? String(row.seller_order_id) : null,
      stripe_transfer_id: null,
      stripe_refund_id: null,
      platform_fee_cents: null,
      created_at: String(row.created_at),
    });
  }

  for (const row of refundsRes.data ?? []) {
    items.push({
      id: `refund_${row.id}`,
      kind: "refund",
      status: String(row.refund_status ?? "refunded"),
      amount_cents: Math.max(0, Math.round(Number(row.total_cents ?? 0))),
      currency: String(row.currency ?? "USD"),
      direction: "debit",
      title: "Order refund",
      subtitle: row.stripe_refund_id
        ? `Stripe ${String(row.stripe_refund_id)}`
        : null,
      seller_order_id: String(row.id),
      stripe_transfer_id: null,
      stripe_refund_id: row.stripe_refund_id
        ? String(row.stripe_refund_id)
        : null,
      platform_fee_cents: null,
      created_at: String(row.stripe_refunded_at ?? row.updated_at ?? row.created_at),
    });
  }

  items.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return items.slice(0, limit);
}
