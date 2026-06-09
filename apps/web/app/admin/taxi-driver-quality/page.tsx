"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiDriverQuality } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type ScoreRow = {
  user_id: string;
  quality_score: number;
  completed_rides: number;
  cancel_rate: number;
  premium_active: boolean;
  documents_ok: boolean;
  taxi_driver_features?: {
    premium_eligible?: boolean | null;
    vehicle_class?: string | null;
  } | null;
};

export default function AdminTaxiDriverQualityPage() {
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiDriverQuality(session?.role ?? null));

    const res = await adminFetch("/api/admin/taxi-driver-quality");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Load failed");
      setScores([]);
    } else {
      setScores(body.scores ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(
    driverId: string,
    action: "refresh" | "set_premium",
    premiumActive?: boolean
  ) {
    if (!canEdit) return;
    setActionId(driverId);
    const res = await adminFetch("/api/admin/taxi-driver-quality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driver_id: driverId,
        action,
        premium_active: premiumActive,
      }),
    });
    const body = await res.json().catch(() => ({}));
    setActionId(null);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Action failed");
      return;
    }
    await load();
  }

  return (
    <AdminGate requiredPermission="taxi_driver_quality.read">
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Taxi Driver Quality</h1>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {loading ? <p>Loading…</p> : null}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Driver</th>
              <th align="left">Score</th>
              <th align="left">Rides</th>
              <th align="left">Cancel rate</th>
              <th align="left">Premium</th>
              <th align="left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((row) => (
              <tr key={row.user_id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{row.user_id.slice(0, 8)}…</td>
                <td>{Number(row.quality_score).toFixed(1)}</td>
                <td>{row.completed_rides}</td>
                <td>{(Number(row.cancel_rate) * 100).toFixed(1)}%</td>
                <td>
                  {row.premium_active ? "⭐ Premium" : "Standard"}
                  {row.taxi_driver_features?.premium_eligible ? " (eligible)" : ""}
                </td>
                <td style={{ display: "flex", gap: 8 }}>
                  {canEdit ? (
                    <>
                      <button
                        type="button"
                        disabled={actionId === row.user_id}
                        onClick={() => runAction(row.user_id, "refresh")}
                      >
                        Refresh
                      </button>
                      <button
                        type="button"
                        disabled={actionId === row.user_id}
                        onClick={() => runAction(row.user_id, "set_premium", true)}
                      >
                        Promote
                      </button>
                      <button
                        type="button"
                        disabled={actionId === row.user_id}
                        onClick={() => runAction(row.user_id, "set_premium", false)}
                      >
                        Demote
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
