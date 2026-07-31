"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type Overlay = {
  id: string;
  kind: string;
  title: string | null;
  body: string | null;
  cta_label: string | null;
  cta_href: string | null;
  placement: string;
  dismissible: boolean;
  sort_order: number;
  status: string;
};

const EMPTY = {
  id: "",
  kind: "banner",
  title: "",
  body: "",
  cta_label: "",
  cta_href: "",
  placement: "top",
  dismissible: true,
  sort_order: "0",
  status: "draft",
};

function OverlaysInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [rows, setRows] = useState<Overlay[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch("/api/admin/site/overlays");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    setRows((res.overlays as Overlay[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        id: form.id || undefined,
        kind: form.kind,
        title: form.title || null,
        body: form.body || null,
        cta_label: form.cta_label || null,
        cta_href: form.cta_href || null,
        placement: form.placement,
        dismissible: form.dismissible,
        sort_order: Number(form.sort_order) || 0,
        status: form.status,
      };
      const http = await adminFetch("/api/admin/site/overlays", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Save failed"));
        return;
      }
      setNotice(form.id ? "Overlay updated." : "Overlay created.");
      setForm(EMPTY);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!canEdit || !window.confirm("Delete overlay?")) return;
    const http = await adminFetch(`/api/admin/site/overlays?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Delete failed"));
      return;
    }
    if (form.id === id) setForm(EMPTY);
    await load();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link href="/admin/site" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Corporate Website
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Overlays</h1>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className={`${CARD} space-y-3`}>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Kind</span>
            <select
              className={INPUT}
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              disabled={!canEdit}
            >
              <option value="banner">banner</option>
              <option value="popup">popup</option>
              <option value="announcement">announcement</option>
              <option value="promo">promo</option>
            </select>
          </label>
          <label className="block">
            <span className={LABEL}>Status</span>
            <select
              className={INPUT}
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              disabled={!canEdit}
            >
              <option value="draft">draft</option>
              <option value="scheduled">scheduled</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>Title</span>
            <input
              className={INPUT}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>Body</span>
            <textarea
              className={`${INPUT} min-h-[80px]`}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>CTA label</span>
            <input
              className={INPUT}
              value={form.cta_label}
              onChange={(e) => setForm({ ...form, cta_label: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>CTA href</span>
            <input
              className={INPUT}
              value={form.cta_href}
              onChange={(e) => setForm({ ...form, cta_href: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Placement</span>
            <input
              className={INPUT}
              value={form.placement}
              onChange={(e) => setForm({ ...form, placement: e.target.value })}
              disabled={!canEdit}
            />
          </label>
          <label className="block">
            <span className={LABEL}>Sort order</span>
            <input
              className={INPUT}
              type="number"
              value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
              disabled={!canEdit}
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={!canEdit || saving}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : form.id ? "Update" : "Create"}
        </button>
      </form>

      <div className={`${CARD} space-y-2`}>
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2"
          >
            <div>
              <div className="font-semibold text-slate-900">{row.title || row.kind}</div>
              <div className="text-xs text-slate-500">
                {row.kind} · {row.placement} · {row.status}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-semibold"
                onClick={() =>
                  setForm({
                    id: row.id,
                    kind: row.kind,
                    title: row.title ?? "",
                    body: row.body ?? "",
                    cta_label: row.cta_label ?? "",
                    cta_href: row.cta_href ?? "",
                    placement: row.placement,
                    dismissible: row.dismissible,
                    sort_order: String(row.sort_order),
                    status: row.status,
                  })
                }
              >
                Edit
              </button>
              <button
                type="button"
                disabled={!canEdit}
                className="rounded-lg border border-red-200 px-3 py-1 text-sm font-semibold text-red-600"
                onClick={() => void onDelete(row.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SiteOverlaysPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <OverlaysInner />
    </AdminGate>
  );
}
