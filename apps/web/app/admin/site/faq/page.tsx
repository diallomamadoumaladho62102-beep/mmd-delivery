"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type FaqItem = {
  id: string;
  category: string;
  question: string;
  answer_md: string;
  sort_order: number;
  visible: boolean;
};

const EMPTY = {
  id: "",
  category: "general",
  question: "",
  answer_md: "",
  sort_order: "10",
  visible: true,
};

function FaqInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [items, setItems] = useState<FaqItem[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch("/api/admin/site/faq");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    setItems((res.items as FaqItem[]) ?? []);
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
        category: form.category,
        question: form.question,
        answer_md: form.answer_md,
        sort_order: Number(form.sort_order) || 0,
        visible: form.visible,
      };
      const http = await adminFetch("/api/admin/site/faq", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Save failed"));
        return;
      }
      setNotice(form.id ? "FAQ updated." : "FAQ created.");
      setForm(EMPTY);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!canEdit || !window.confirm("Delete FAQ item?")) return;
    const http = await adminFetch(`/api/admin/site/faq?id=${encodeURIComponent(id)}`, {
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
        <h1 className="mt-2 text-2xl font-bold text-slate-900">FAQ</h1>
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
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">{form.id ? "Edit item" : "New item"}</h2>
          {form.id ? (
            <button type="button" className="text-sm text-slate-500" onClick={() => setForm(EMPTY)}>
              New
            </button>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className={LABEL}>Category</span>
            <input
              className={INPUT}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
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
          <label className="block md:col-span-2">
            <span className={LABEL}>Question</span>
            <input
              className={INPUT}
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
              disabled={!canEdit}
              required
            />
          </label>
          <label className="block md:col-span-2">
            <span className={LABEL}>Answer (Markdown)</span>
            <textarea
              className={`${INPUT} min-h-[120px]`}
              value={form.answer_md}
              onChange={(e) => setForm({ ...form, answer_md: e.target.value })}
              disabled={!canEdit}
              required
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.visible}
              onChange={(e) => setForm({ ...form, visible: e.target.checked })}
              disabled={!canEdit}
            />
            Visible
          </label>
        </div>
        <button
          type="submit"
          disabled={!canEdit || saving}
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>

      <div className={`${CARD} space-y-2`}>
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2"
          >
            <div>
              <div className="font-semibold text-slate-900">{item.question}</div>
              <div className="text-xs text-slate-500">
                {item.category} · order {item.sort_order} · {item.visible ? "visible" : "hidden"}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-semibold"
                onClick={() =>
                  setForm({
                    id: item.id,
                    category: item.category,
                    question: item.question,
                    answer_md: item.answer_md,
                    sort_order: String(item.sort_order),
                    visible: item.visible,
                  })
                }
              >
                Edit
              </button>
              <button
                type="button"
                disabled={!canEdit}
                className="rounded-lg border border-red-200 px-3 py-1 text-sm font-semibold text-red-600"
                onClick={() => void onDelete(item.id)}
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

export default function SiteFaqPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <FaqInner />
    </AdminGate>
  );
}
