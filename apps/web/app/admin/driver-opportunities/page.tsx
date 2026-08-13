"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";

type OpportunityRow = {
  id: string;
  category: string;
  title: string;
  subtitle: string | null;
  starts_at: string | null;
  ends_at: string | null;
  lat: number | null;
  lng: number | null;
  bonus_cents: number;
  currency: string;
  capacity: number | null;
  status: string;
  created_at: string;
};

const CATEGORIES = [
  { value: "promotions", label: "Promotions" },
  { value: "airports", label: "Airports" },
  { value: "reservations", label: "Reservations" },
  { value: "events", label: "Events" },
] as const;

const EMPTY_FORM = {
  category: "promotions",
  title: "",
  subtitle: "",
  starts_at: "",
  ends_at: "",
  lat: "",
  lng: "",
  bonus_cents: "0",
  currency: "USD",
  capacity: "",
  status: "draft" as "draft" | "published" | "archived",
};

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function statusBadgeClass(status: string): string {
  if (status === "published") return "bg-emerald-50 text-emerald-700";
  if (status === "archived") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-700";
}

export default function AdminDriverOpportunitiesPage() {
  const [rows, setRows] = useState<OpportunityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminFetch("/api/admin/driver-opportunities");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Failed to load opportunities");
      setRows([]);
    } else {
      setRows(body.items ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setNotice(null);
  }

  function editRow(row: OpportunityRow) {
    setEditingId(row.id);
    setForm({
      category: row.category,
      title: row.title,
      subtitle: row.subtitle ?? "",
      starts_at: toLocalInput(row.starts_at),
      ends_at: toLocalInput(row.ends_at),
      lat: row.lat != null ? String(row.lat) : "",
      lng: row.lng != null ? String(row.lng) : "",
      bonus_cents: String(row.bonus_cents ?? 0),
      currency: row.currency ?? "USD",
      capacity: row.capacity != null ? String(row.capacity) : "",
      status: (row.status as typeof form.status) ?? "draft",
    });
    setNotice(null);
    setError(null);
  }

  async function saveOpportunity(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    const payload: Record<string, unknown> = {
      category: form.category,
      title: form.title.trim(),
      subtitle: form.subtitle.trim() || null,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      lat: form.lat.trim() ? Number(form.lat) : null,
      lng: form.lng.trim() ? Number(form.lng) : null,
      bonus_cents: Number(form.bonus_cents) || 0,
      currency: form.currency.trim() || "USD",
      capacity: form.capacity.trim() ? Number(form.capacity) : null,
      status: form.status,
    };

    try {
      const res = await adminFetch("/api/admin/driver-opportunities", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? "Save failed");
      }
      setNotice(editingId ? "Opportunity updated." : "Opportunity created.");
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function publishRow(row: OpportunityRow) {
    setError(null);
    setNotice(null);
    const res = await adminFetch("/api/admin/driver-opportunities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, status: "published" }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Publish failed");
      return;
    }
    setNotice(`"${row.title}" published.`);
    await load();
  }

  async function archiveRow(row: OpportunityRow) {
    setError(null);
    setNotice(null);
    const res = await adminFetch("/api/admin/driver-opportunities", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: row.id, status: "archived" }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Archive failed");
      return;
    }
    setNotice(`"${row.title}" archived.`);
    await load();
  }

  return (
    <AdminGate requiredPermission="users.drivers.manage">
      <main className="space-y-6">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-muted)]">
                Operations
              </p>
              <h1 className="text-2xl font-bold text-slate-900">
                Driver Opportunities
              </h1>
              <p className="mt-1 text-sm text-[var(--cc-muted)]">
                Create and publish shift opportunities shown in the driver mobile
                feed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="h-10 rounded-xl border border-[var(--cc-border)] bg-white px-4 text-sm font-medium text-slate-700"
            >
              Refresh
            </button>
          </header>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              {notice}
            </div>
          ) : null}

          <section className="cc-card p-5">
            <h2 className="text-lg font-semibold text-slate-900">
              {editingId ? "Edit opportunity" : "New opportunity"}
            </h2>
            <form
              onSubmit={saveOpportunity}
              className="mt-4 grid gap-4 md:grid-cols-2"
            >
              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Category
                </span>
                <select
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value })
                  }
                  required
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Status
                </span>
                <select
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as typeof form.status,
                    })
                  }
                >
                  <option value="draft">Draft</option>
                  <option value="published">Published</option>
                  <option value="archived">Archived</option>
                </select>
              </label>

              <label className="block text-sm md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Title
                </span>
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  required
                />
              </label>

              <label className="block text-sm md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Subtitle (optional)
                </span>
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.subtitle}
                  onChange={(e) =>
                    setForm({ ...form, subtitle: e.target.value })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Starts at
                </span>
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.starts_at}
                  onChange={(e) =>
                    setForm({ ...form, starts_at: e.target.value })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Ends at
                </span>
                <input
                  type="datetime-local"
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.ends_at}
                  onChange={(e) =>
                    setForm({ ...form, ends_at: e.target.value })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Bonus (cents)
                </span>
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.bonus_cents}
                  onChange={(e) =>
                    setForm({ ...form, bonus_cents: e.target.value })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Currency
                </span>
                <input
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.currency}
                  onChange={(e) =>
                    setForm({ ...form, currency: e.target.value.toUpperCase() })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Capacity (optional)
                </span>
                <input
                  type="number"
                  min={1}
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.capacity}
                  onChange={(e) =>
                    setForm({ ...form, capacity: e.target.value })
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Latitude
                </span>
                <input
                  type="number"
                  step="any"
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                />
              </label>

              <label className="block text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--cc-muted)]">
                  Longitude
                </span>
                <input
                  type="number"
                  step="any"
                  className="mt-1 w-full rounded-xl border border-[var(--cc-border)] px-3 py-2 text-sm"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                />
              </label>

              <div className="flex flex-wrap gap-2 md:col-span-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="h-10 rounded-xl bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-60"
                >
                  {saving
                    ? "Saving…"
                    : editingId
                      ? "Save changes"
                      : "Create draft"}
                </button>
                {editingId ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="h-10 rounded-xl border border-[var(--cc-border)] bg-white px-4 text-sm font-medium text-slate-700"
                  >
                    Cancel edit
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="cc-card overflow-x-auto">
            <h2 className="border-b border-[var(--cc-border)] px-5 py-4 text-lg font-semibold text-slate-900">
              Catalog
            </h2>
            {loading ? (
              <p className="px-5 py-6 text-sm text-[var(--cc-muted)]">
                Loading…
              </p>
            ) : rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[var(--cc-muted)]">
                No opportunities yet. Create one above to publish to drivers.
              </p>
            ) : (
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-[var(--cc-border)] bg-slate-50 text-xs uppercase text-[var(--cc-muted)]">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Schedule</th>
                    <th className="px-4 py-3">Bonus</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {row.title}
                        </div>
                        {row.subtitle ? (
                          <div className="text-xs text-[var(--cc-muted)]">
                            {row.subtitle}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 capitalize">{row.category}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--cc-muted)]">
                        {row.starts_at
                          ? new Date(row.starts_at).toLocaleString()
                          : "—"}
                        {row.ends_at ? (
                          <>
                            <br />
                            → {new Date(row.ends_at).toLocaleString()}
                          </>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {formatMoney(row.bonus_cents, row.currency)}
                        {row.capacity != null ? (
                          <div className="text-xs text-[var(--cc-muted)]">
                            cap {row.capacity}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => editRow(row)}
                            className="rounded-lg border border-[var(--cc-border)] px-2 py-1 text-xs font-medium text-slate-700"
                          >
                            Edit
                          </button>
                          {row.status === "draft" ? (
                            <button
                              type="button"
                              onClick={() => void publishRow(row)}
                              className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white"
                            >
                              Publish
                            </button>
                          ) : null}
                          {row.status !== "archived" ? (
                            <button
                              type="button"
                              onClick={() => void archiveRow(row)}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600"
                            >
                              Archive
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </main>
    </AdminGate>
  );
}
