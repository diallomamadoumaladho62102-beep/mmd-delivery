"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { canReadTaxiSharedRides } from "@/lib/adminAccess";

type SharedRow = {
  id: string;
  status: string;
  passenger_count: number;
  max_passengers: number;
  discount_percent: number;
  window_expires_at: string;
  taxi_shared_ride_passengers?: {
    segment_order: number;
    pickup_address?: string | null;
    dropoff_address?: string | null;
    share_discount_cents?: number | null;
    status?: string | null;
  }[];
};

export default function AdminTaxiSharedRidesPage() {
  const [rows, setRows] = useState<SharedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canView, setCanView] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanView(canReadTaxiSharedRides(session?.role ?? null));

    const res = await adminFetch("/api/admin/taxi-shared-rides");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Load failed");
      setRows([]);
    } else {
      setRows(body.items ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminGate requiredPermission="taxi_shared_rides.read">
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Taxi Shared Rides</h1>
        {!canView ? <p>Read-only access required.</p> : null}
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {loading ? <p>Loading…</p> : null}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Status</th>
              <th align="left">Passengers</th>
              <th align="left">Discount</th>
              <th align="left">Window</th>
              <th align="left">Segments</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{row.status}</td>
                <td>
                  {row.passenger_count}/{row.max_passengers}
                </td>
                <td>{row.discount_percent}%</td>
                <td>{new Date(row.window_expires_at).toLocaleString()}</td>
                <td>
                  {(row.taxi_shared_ride_passengers ?? [])
                    .sort((a, b) => a.segment_order - b.segment_order)
                    .map((p) => (
                      <div key={`${row.id}-${p.segment_order}`}>
                        #{p.segment_order}: {p.pickup_address} → {p.dropoff_address} (
                        {p.status})
                      </div>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </AdminGate>
  );
}
