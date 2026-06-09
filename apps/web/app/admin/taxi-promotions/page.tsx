"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiPromotions } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type PromoRow = {
  id: string;
  code: string;
  promotion_type: string;
  discount_percent: number | null;
  discount_cents: number | null;
  active: boolean;
  starts_at: string;
  ends_at: string | null;
  max_redemptions: number | null;
  max_redemptions_per_user: number | null;
  redemption_count: number;
  title: string | null;
};

const EMPTY_FORM = {
  code: "",
  promotion_type: "percent",
  discount_percent: "10",
  discount_cents: "",
  active: true,
  max_redemptions: "",
  max_redemptions_per_user: "1",
  title: "",
};

export default function AdminTaxiPromotionsPage() {
  const [rows, setRows] = useState<PromoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiPromotions(session?.role ?? null));

    const res = await adminFetch("/api/admin/taxi-promotions");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createPromo(e: FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await adminFetch("/api/admin/taxi-promotions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          promotion_type: form.promotion_type,
          discount_percent:
            form.promotion_type !== "fixed" ? Number(form.discount_percent) : null,
          discount_cents:
            form.promotion_type === "fixed" ? Number(form.discount_cents) : null,
          active: form.active,
          max_redemptions: form.max_redemptions
            ? Number(form.max_redemptions)
            : null,
          max_redemptions_per_user: form.max_redemptions_per_user
            ? Number(form.max_redemptions_per_user)
            : null,
          title: form.title || null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? "Create failed");
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: PromoRow) {
    if (!canEdit) return;
    const res = await adminFetch("/api/admin/taxi-promotions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, active: !row.active }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Update failed");
      return;
    }
    await load();
  }

  return (
    <AdminGate requiredPermission="taxi_promotions.read">
      <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
        <h1>Taxi Promotions</h1>
        {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
        {loading ? <p>Chargement…</p> : null}

        {canEdit ? (
          <form onSubmit={createPromo} style={{ display: "grid", gap: 8, marginBottom: 24 }}>
            <h2>Nouvelle promotion</h2>
            <input
              placeholder="Code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              required
            />
            <select
              value={form.promotion_type}
              onChange={(e) => setForm({ ...form, promotion_type: e.target.value })}
            >
              <option value="percent">Percent</option>
              <option value="fixed">Fixed amount</option>
              <option value="first_ride">First ride</option>
            </select>
            {form.promotion_type !== "fixed" ? (
              <input
                placeholder="Discount %"
                value={form.discount_percent}
                onChange={(e) => setForm({ ...form, discount_percent: e.target.value })}
              />
            ) : (
              <input
                placeholder="Discount cents"
                value={form.discount_cents}
                onChange={(e) => setForm({ ...form, discount_cents: e.target.value })}
              />
            )}
            <input
              placeholder="Max redemptions (optional)"
              value={form.max_redemptions}
              onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })}
            />
            <input
              placeholder="Max per user"
              value={form.max_redemptions_per_user}
              onChange={(e) =>
                setForm({ ...form, max_redemptions_per_user: e.target.value })
              }
            />
            <input
              placeholder="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Create promotion"}
            </button>
          </form>
        ) : null}

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">Code</th>
              <th align="left">Type</th>
              <th align="left">Value</th>
              <th align="left">Used</th>
              <th align="left">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td>{row.code}</td>
                <td>{row.promotion_type}</td>
                <td>
                  {row.discount_percent != null
                    ? `${row.discount_percent}%`
                    : row.discount_cents != null
                      ? `$${(row.discount_cents / 100).toFixed(2)}`
                      : "—"}
                </td>
                <td>
                  {row.redemption_count}
                  {row.max_redemptions != null ? ` / ${row.max_redemptions}` : ""}
                </td>
                <td>
                  {canEdit ? (
                    <button type="button" onClick={() => toggleActive(row)}>
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
