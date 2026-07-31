"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type MenuItem = {
  id?: string;
  label: string;
  href: string;
  target: string;
  sort_order: number;
  visible: boolean;
};

function MenusInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [key, setKey] = useState<"header" | "footer">("header");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch(`/api/admin/site/menus?key=${key}`);
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    const menus = res.menus as Record<string, { items: MenuItem[] }>;
    setItems(menus?.[key]?.items ?? []);
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateItem = (index: number, patch: Partial<MenuItem>) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        label: "New link",
        href: "/",
        target: "_self",
        sort_order: (prev.length + 1) * 10,
        visible: true,
      },
    ]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const save = async () => {
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const http = await adminFetch("/api/admin/site/menus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, items }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Save failed"));
        return;
      }
      setNotice(`${key} menu saved.`);
      setItems((res.items as MenuItem[]) ?? []);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link href="/admin/site" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Corporate Website
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Menus</h1>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      <div className="flex gap-2">
        {(["header", "footer"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKey(k)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold ${
              key === k
                ? "bg-slate-900 text-white"
                : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {k}
          </button>
        ))}
      </div>

      <div className={`${CARD} space-y-3`}>
        {items.map((item, index) => (
          <div key={`${item.id ?? "new"}-${index}`} className="grid gap-2 rounded-xl border border-slate-100 p-3 md:grid-cols-5">
            <label className="block md:col-span-2">
              <span className={LABEL}>Label</span>
              <input
                className={INPUT}
                value={item.label}
                onChange={(e) => updateItem(index, { label: e.target.value })}
                disabled={!canEdit}
              />
            </label>
            <label className="block md:col-span-2">
              <span className={LABEL}>Href</span>
              <input
                className={INPUT}
                value={item.href}
                onChange={(e) => updateItem(index, { href: e.target.value })}
                disabled={!canEdit}
              />
            </label>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={item.visible}
                  onChange={(e) => updateItem(index, { visible: e.target.checked })}
                  disabled={!canEdit}
                />
                Visible
              </label>
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => removeItem(index)}
                className="rounded-lg border border-red-200 px-2 py-1 text-xs font-semibold text-red-600"
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canEdit}
            onClick={addItem}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Add item
          </button>
          <button
            type="button"
            disabled={!canEdit || saving}
            onClick={() => void save()}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save menu"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SiteMenusPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <MenusInner />
    </AdminGate>
  );
}
