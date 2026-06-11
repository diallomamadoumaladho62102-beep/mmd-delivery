"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { canViewSellers } from "@/lib/adminAccess";

type DispatchJobRow = {
  id: string;
  seller_order_id: string;
  seller?: { business_name?: string | null; country_code?: string | null; city?: string | null } | null;
  status?: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  assigned_driver_id?: string | null;
  estimated_distance_miles?: number | null;
  estimated_minutes?: number | null;
  driver_earning_cents?: number | null;
  platform_margin_cents?: number | null;
  live_dispatch_enabled?: boolean;
  drivers_notified?: boolean;
  platform_dispatch_live_flag?: boolean;
  updated_at?: string;
};

function formatMoney(cents: number | null | undefined, currency = "USD") {
  return `${((Number(cents) || 0) / 100).toFixed(2)} ${currency}`;
}

export default function AdminMarketplaceDispatchPage() {
  const [rows, setRows] = useState<DispatchJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canView, setCanView] = useState(false);
  const [platformFlag, setPlatformFlag] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanView(canViewSellers(session?.role ?? null));
    const res = await adminFetch("/api/admin/marketplace-dispatch");
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setPlatformFlag(body.live_dispatch_enabled === true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminGate requiredPermission="users.sellers.read">
      <div style={{ padding: 24, color: "#E2E8F0" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Marketplace Dispatch</h1>
        <p style={{ color: "#94A3B8", marginBottom: 20 }}>
          Paid marketplace delivery jobs — prepared for live dispatch but OFF by default (
          MARKETPLACE_DISPATCH_LIVE_ENABLED={String(platformFlag)}). No driver notifications,
          no delivery_requests, no payout changes.
        </p>

        {!canView ? (
          <p>Read-only access required.</p>
        ) : loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>
            No marketplace dispatch jobs yet. Jobs are created when a seller order is marked paid
            (live checkout webhook path).
          </p>
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
                    <strong>{row.seller?.business_name ?? "Seller"}</strong>
                    <div style={{ color: "#94A3B8", fontSize: 13 }}>
                      {row.seller_order_id} · {row.status ?? "—"}
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
                    {row.pickup_address ?? "—"}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Dropoff: </span>
                    {row.dropoff_address ?? "—"}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Assigned driver: </span>
                    {row.assigned_driver_id ?? "—"}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Driver earning: </span>
                    {formatMoney(row.driver_earning_cents)}
                  </div>
                  <div>
                    <span style={{ color: "#94A3B8" }}>Platform margin: </span>
                    {formatMoney(row.platform_margin_cents)}
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
