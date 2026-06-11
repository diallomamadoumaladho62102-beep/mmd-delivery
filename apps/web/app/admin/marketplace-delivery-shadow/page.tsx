"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { canViewSellers } from "@/lib/adminAccess";

type ShadowRow = {
  seller_order_id: string;
  seller?: { business_name?: string | null; country_code?: string | null; city?: string | null } | null;
  status?: string;
  pickup_location_id?: string | null;
  dropoff_location_id?: string | null;
  seller_pickup_address?: string | null;
  pickup?: { formatted_address?: string | null } | null;
  dropoff?: { formatted_address?: string | null } | null;
  estimated_distance_miles?: number | null;
  estimated_minutes?: number | null;
  customer_delivery_total_shadow_cents?: number | null;
  driver_earning_shadow_cents?: number | null;
  platform_margin_shadow_cents?: number | null;
  delivery_status_shadow?: string | null;
  dispatch_readiness?: string | null;
  live_dispatch_enabled?: boolean;
  drivers_notified?: boolean;
  dispatch_shadow?: Record<string, unknown> | null;
  updated_at?: string;
};

function formatMoney(cents: number | null | undefined, currency = "USD") {
  return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency}`;
}

export default function AdminMarketplaceDeliveryShadowPage() {
  const [rows, setRows] = useState<ShadowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canView, setCanView] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanView(canViewSellers(session?.role ?? null));
    const res = await adminFetch("/api/admin/marketplace-delivery-shadow");
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminGate requiredPermission="users.sellers.read">
      <div style={{ padding: 24, color: "#E2E8F0" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Marketplace Delivery Shadow</h1>
        <p style={{ color: "#94A3B8", marginBottom: 20 }}>
          Simulated delivery quotes and dispatch readiness only — no live dispatch, no driver
          notifications, no Stripe.
        </p>

        {!canView ? (
          <p>Read-only access required.</p>
        ) : loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>No marketplace delivery shadow rows yet. Enable MARKETPLACE_DELIVERY_SHADOW_ENABLED in staging and save a draft with locations.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {rows.map((row) => (
              <div
                key={row.seller_order_id}
                style={{
                  border: "1px solid #334155",
                  borderRadius: 12,
                  padding: 16,
                  background: "#0B1220",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <strong>{row.seller?.business_name ?? "Seller"}</strong>
                    <div style={{ color: "#94A3B8", fontSize: 13 }}>
                      {row.seller_order_id} · {row.delivery_status_shadow ?? "—"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", color: "#CBD5E1", fontSize: 13 }}>
                    {row.estimated_distance_miles != null
                      ? `${Number(row.estimated_distance_miles).toFixed(2)} mi · ${Math.round(Number(row.estimated_minutes ?? 0))} min`
                      : "—"}
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 13 }}>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Pickup: </span>
                    {row.pickup?.formatted_address ?? row.seller_pickup_address ?? row.pickup_location_id ?? "—"}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Dropoff: </span>
                    {row.dropoff?.formatted_address ?? row.dropoff_location_id ?? "—"}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Customer delivery (shadow): </span>
                    {formatMoney(row.customer_delivery_total_shadow_cents)}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Driver earning (shadow): </span>
                    {formatMoney(row.driver_earning_shadow_cents)}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Platform margin (shadow): </span>
                    {formatMoney(row.platform_margin_shadow_cents)}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Dispatch readiness: </span>
                    {row.dispatch_readiness ?? "—"}
                  </div>
                  <div style={{ color: "#64748B" }}>
                    live_dispatch_enabled={String(row.live_dispatch_enabled ?? false)} ·
                    drivers_notified={String(row.drivers_notified ?? false)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminGate>
  );
}
