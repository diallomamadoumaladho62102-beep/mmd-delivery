"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const INPUT = "mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

type PageRow = {
  id: string;
  slug: string;
  title: string;
  kind: string;
  status: string;
  updated_at: string;
};

function PagesListInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [rows, setRows] = useState<PageRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch("/api/admin/site/pages?limit=200");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    setRows((res.pages as PageRow[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createPage = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const http = await adminFetch("/api/admin/site/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, title, status: "draft" }),
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Create failed"));
        return;
      }
      const page = res.page as PageRow;
      setNotice("Page created.");
      setSlug("");
      setTitle("");
      await load();
      if (page?.id) window.location.href = `/admin/site/pages/${page.id}`;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link href="/admin/site" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Corporate Website
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">Pages</h1>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {notice}
        </div>
      ) : null}

      {canEdit ? (
        <form onSubmit={createPage} className={`${CARD} grid gap-3 sm:grid-cols-3`}>
          <label className="block">
            <span className={LABEL}>Slug</span>
            <input className={INPUT} value={slug} onChange={(e) => setSlug(e.target.value)} required />
          </label>
          <label className="block">
            <span className={LABEL}>Title</span>
            <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create page"}
            </button>
          </div>
        </form>
      ) : null}

      <div className={`${CARD} space-y-2`}>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No pages.</p>
        ) : (
          rows.map((row) => (
            <Link
              key={row.id}
              href={`/admin/site/pages/${row.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 px-3 py-2 hover:bg-slate-50"
            >
              <div>
                <div className="font-semibold text-slate-900">{row.title}</div>
                <div className="text-xs text-slate-500">
                  /{row.slug} · {row.kind} · {row.status}
                </div>
              </div>
              <span className="text-xs text-slate-400">
                {row.updated_at ? new Date(row.updated_at).toLocaleString() : ""}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}

export default function SitePagesListPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <PagesListInner />
    </AdminGate>
  );
}
