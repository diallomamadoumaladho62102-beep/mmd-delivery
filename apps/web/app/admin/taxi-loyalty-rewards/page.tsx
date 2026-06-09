"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiRides } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type RewardRow = {
  id: string;
  title: string;
  points_cost: number;
  discount_cents: number;
  tier_required: string | null;
  active: boolean;
};

export default function AdminTaxiLoyaltyRewardsPage() {
  const [rows, setRows] = useState<RewardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState({
    title: "",
    points_cost: "100",
    discount_cents: "500",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiRides(session?.role ?? null));
    const res = await adminFetch("/api/admin/taxi-loyalty-rewards");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) setError(body.error ?? "Load failed");
    else setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createReward(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    const res = await adminFetch("/api/admin/taxi-loyalty-rewards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        points_cost: Number(form.points_cost),
        discount_cents: Number(form.discount_cents),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Create failed");
      return;
    }
    setForm({ title: "", points_cost: "100", discount_cents: "500" });
    await load();
  }

  async function toggle(row: RewardRow) {
    if (!canEdit) return;
    await adminFetch("/api/admin/taxi-loyalty-rewards", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, active: !row.active }),
    });
    await load();
  }

  return (
    <AdminGate requiredPermission="taxi_rides.read">
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Taxi Loyalty Rewards</h1>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {canEdit ? (
          <form onSubmit={createReward} style={{ display: "grid", gap: 8, marginBottom: 24 }}>
            <input
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
            <input
              placeholder="Points cost"
              value={form.points_cost}
              onChange={(e) => setForm({ ...form, points_cost: e.target.value })}
            />
            <input
              placeholder="Discount cents"
              value={form.discount_cents}
              onChange={(e) => setForm({ ...form, discount_cents: e.target.value })}
            />
            <button type="submit">Create reward</button>
          </form>
        ) : null}
        {loading ? <p>Loading…</p> : null}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Title</th>
              <th align="left">Points</th>
              <th align="left">Credit</th>
              <th align="left">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{row.title}</td>
                <td>{row.points_cost}</td>
                <td>${(row.discount_cents / 100).toFixed(2)}</td>
                <td>
                  {canEdit ? (
                    <button type="button" onClick={() => toggle(row)}>
                      {row.active ? "Disable" : "Enable"}
                    </button>
                  ) : row.active ? (
                    "Yes"
                  ) : (
                    "No"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </AdminGate>
  );
}
