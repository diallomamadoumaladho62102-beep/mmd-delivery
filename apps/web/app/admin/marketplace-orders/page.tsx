"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { canViewSellers } from "@/lib/adminAccess";

type MarketplaceOrderRow = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  payment_status?: string | null;
  currency: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  total_cents: number;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  paid_at?: string | null;
  created_at: string;
  sellers?: { business_name?: string | null } | null;
  seller_order_items?: Array<{
    id: string;
    title: string;
    quantity: number;
    price_cents: number;
  }>;
};

function formatMoney(cents: number, currency = "USD") {
  return `${(Number(cents || 0) / 100).toFixed(2)} ${currency}`;
}

export default function AdminMarketplaceOrdersPage() {
  const [rows, setRows] = useState<MarketplaceOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canView, setCanView] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanView(canViewSellers(session?.role ?? null));
    const qs = statusFilter !== "all" ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const res = await adminFetch(`/api/admin/marketplace-orders${qs}`);
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminGate requiredPermission="users.sellers.read">
      <div style={{ padding: 24, color: "#E2E8F0" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Marketplace Orders (Draft / Checkout)</h1>
        <p style={{ color: "#94A3B8", marginBottom: 20 }}>
          Draft, shadow checkout, and live payment preparation — payouts and marketplace dispatch remain off until go-live.
        </p>

        {!canView ? (
          <p>Read-only access required.</p>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              {["all", "draft", "pending_checkout", "pending_payment", "paid", "payment_failed"].map(
                (value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "1px solid #334155",
                    background: statusFilter === value ? "#312E81" : "#0F172A",
                    color: "#E2E8F0",
                  }}
                >
                  {value}
                </button>
              )
              )}
            </div>

            {loading ? (
              <p>Loading…</p>
            ) : rows.length === 0 ? (
              <p>No draft marketplace orders.</p>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {rows.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      border: "1px solid #334155",
                      borderRadius: 12,
                      padding: 16,
                      background: "#0B1220",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div>
                        <strong>{row.sellers?.business_name ?? "Seller"}</strong>
                        <div style={{ color: "#94A3B8", fontSize: 13 }}>
                          {row.status}
                          {row.payment_status ? ` · pay ${row.payment_status}` : ""} · {row.id}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div>{formatMoney(row.total_cents, row.currency)}</div>
                        <div style={{ color: "#94A3B8", fontSize: 12 }}>
                          sub {formatMoney(row.subtotal_cents, row.currency)} · del{" "}
                          {formatMoney(row.delivery_fee_cents, row.currency)} · svc{" "}
                          {formatMoney(row.service_fee_cents, row.currency)}
                        </div>
                      </div>
                    </div>
                    {(row.stripe_checkout_session_id || row.paid_at) && (
                      <div style={{ marginTop: 8, color: "#64748B", fontSize: 12 }}>
                        {row.stripe_checkout_session_id
                          ? `stripe session ${row.stripe_checkout_session_id}`
                          : null}
                        {row.paid_at ? ` · paid_at ${row.paid_at}` : null}
                      </div>
                    )}
                    {(row.seller_order_items ?? []).length > 0 && (
                      <ul style={{ marginTop: 12, paddingLeft: 18, color: "#CBD5E1" }}>
                        {(row.seller_order_items ?? []).map((item) => (
                          <li key={item.id}>
                            {item.quantity}× {item.title} — {formatMoney(item.price_cents, row.currency)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AdminGate>
  );
}
