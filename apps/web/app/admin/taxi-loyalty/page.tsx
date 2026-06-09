"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiRides } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type LoyaltyAccount = {
  user_id: string;
  points_balance: number;
  lifetime_points: number;
  tier: string;
  updated_at: string | null;
};

type FavoriteStats = {
  total_favorites: number;
  unique_drivers_favorited: number;
  rides_with_preferred_driver: number;
  top_drivers: { driver_user_id: string; favorite_count: number }[];
};

export default function AdminTaxiLoyaltyPage() {
  const [accounts, setAccounts] = useState<LoyaltyAccount[]>([]);
  const [stats, setStats] = useState<FavoriteStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [userId, setUserId] = useState("");
  const [delta, setDelta] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiRides(session?.role ?? null));

    const [loyaltyRes, statsRes] = await Promise.all([
      adminFetch("/api/admin/taxi-loyalty"),
      adminFetch("/api/admin/taxi-favorites/stats"),
    ]);

    const loyaltyBody = await loyaltyRes.json().catch(() => ({}));
    const statsBody = await statsRes.json().catch(() => ({}));

    if (!loyaltyRes.ok || !loyaltyBody.ok) {
      setError(loyaltyBody.error ?? "Échec chargement fidélité");
    } else {
      setAccounts(loyaltyBody.items ?? []);
    }

    if (statsRes.ok && statsBody.ok) {
      setStats(statsBody.stats ?? null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function adjust(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/taxi-loyalty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId.trim(),
          delta_points: Number(delta),
          description: description.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Adjust failed");
      setUserId("");
      setDelta("");
      setDescription("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Adjust failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_rides.read">
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Taxi Loyalty & Favorites</h1>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {loading ? <p>Chargement…</p> : null}

        {stats ? (
          <section style={{ marginBottom: 24 }}>
            <h2>Favorite driver stats</h2>
            <ul>
              <li>Total favorites: {stats.total_favorites}</li>
              <li>Unique drivers favorited: {stats.unique_drivers_favorited}</li>
              <li>Rides with preferred driver: {stats.rides_with_preferred_driver}</li>
            </ul>
            {stats.top_drivers.length > 0 ? (
              <>
                <h3>Top drivers</h3>
                <ul>
                  {stats.top_drivers.map((row) => (
                    <li key={row.driver_user_id}>
                      {row.driver_user_id.slice(0, 8)}… — {row.favorite_count} favorites
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>
        ) : null}

        {canEdit ? (
          <form onSubmit={adjust} style={{ display: "grid", gap: 8, marginBottom: 24 }}>
            <h2>Manual loyalty adjustment</h2>
            <input
              placeholder="User ID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            />
            <input
              placeholder="Delta points (+/-)"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              required
            />
            <input
              placeholder="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Apply adjustment"}
            </button>
          </form>
        ) : null}

        <h2>Loyalty accounts</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">User</th>
              <th align="left">Balance</th>
              <th align="left">Lifetime</th>
              <th align="left">Tier</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((row) => (
              <tr key={row.user_id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{row.user_id}</td>
                <td>{row.points_balance}</td>
                <td>{row.lifetime_points}</td>
                <td>{row.tier}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </AdminGate>
  );
}
