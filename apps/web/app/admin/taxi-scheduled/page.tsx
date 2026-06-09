"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiRides } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type ScheduledRow = {
  id: string;
  scheduled_pickup_at: string;
  status: string;
  taxi_rides?: {
    pickup_address?: string | null;
    dropoff_address?: string | null;
    payment_status?: string | null;
    total_cents?: number | null;
  } | null;
};

export default function AdminTaxiScheduledPage() {
  const [rows, setRows] = useState<ScheduledRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiRides(session?.role ?? null));

    const res = await adminFetch("/api/admin/taxi-scheduled");
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

  async function runAction(scheduledId: string, action: "force_dispatch" | "cancel") {
    if (!canEdit) return;
    const res = await adminFetch("/api/admin/taxi-scheduled", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduled_id: scheduledId, action }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Action failed");
      return;
    }
    await load();
  }

  return (
    <AdminGate requiredPermission="taxi_rides.read">
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Taxi Scheduled Rides</h1>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {loading ? <p>Loading…</p> : null}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Pickup</th>
              <th align="left">Route</th>
              <th align="left">Status</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{new Date(row.scheduled_pickup_at).toLocaleString()}</td>
                <td>
                  {row.taxi_rides?.pickup_address} → {row.taxi_rides?.dropoff_address}
                </td>
                <td>{row.status}</td>
                <td style={{ display: "flex", gap: 8 }}>
                  {canEdit ? (
                    <>
                      <button type="button" onClick={() => runAction(row.id, "force_dispatch")}>
                        Dispatch
                      </button>
                      <button type="button" onClick={() => runAction(row.id, "cancel")}>
                        Cancel
                      </button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </AdminGate>
  );
}
