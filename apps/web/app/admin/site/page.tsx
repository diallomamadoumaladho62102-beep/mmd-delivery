"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMarketing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
const LABEL = "text-xs font-semibold uppercase tracking-wide text-slate-500";

const LINKS = [
  { href: "/admin/site/settings", title: "Settings", desc: "Brand, SEO, links" },
  { href: "/admin/site/pages", title: "Pages", desc: "Pages & blocks" },
  { href: "/admin/site/posts", title: "Blog / Posts", desc: "Blog, news, press" },
  { href: "/admin/site/faq", title: "FAQ", desc: "FAQ items" },
  { href: "/admin/site/overlays", title: "Overlays", desc: "Banners & popups" },
  { href: "/admin/site/media", title: "Media", desc: "Image library" },
  { href: "/admin/site/menus", title: "Menus", desc: "Header & footer" },
  { href: "/admin/site/contact", title: "Contact inbox", desc: "Form submissions" },
  { href: "/admin/site/newsletter", title: "Newsletter", desc: "Subscribers" },
] as const;

function SiteDashboardInner() {
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<{
    totals: { last_7_days: number; last_30_days: number };
    last_7_days: Record<string, number>;
  } | null>(null);
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMarketing(session?.role ?? null));
    const http = await adminFetch("/api/admin/site/analytics");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Analytics unavailable"));
      return;
    }
    setAnalytics({
      totals: res.totals as { last_7_days: number; last_30_days: number },
      last_7_days: (res.last_7_days as Record<string, number>) ?? {},
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const promote = async () => {
    if (!canEdit) return;
    setPromoting(true);
    setNotice(null);
    try {
      const http = await adminFetch("/api/admin/site/schedule/promote", {
        method: "POST",
      });
      const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
      if (!http.ok || res.ok === false) {
        setError(String(res.error ?? "Promote failed"));
        return;
      }
      setNotice(`Promoted ${Number(res.promoted ?? 0)} scheduled item(s).`);
    } finally {
      setPromoting(false);
    }
  };

  const topEvents = Object.entries(analytics?.last_7_days ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Corporate Website CMS</h1>
          <p className="mt-1 text-sm text-slate-600">
            Manage pages, blog, media, SEO, and site content for the corporate site.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            disabled={promoting}
            onClick={() => void promote()}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 disabled:opacity-50"
          >
            {promoting ? "Promoting…" : "Promote scheduled"}
          </button>
        ) : null}
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

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={CARD}>
          <div className={LABEL}>Events · 7 days</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {analytics?.totals.last_7_days ?? "—"}
          </div>
        </div>
        <div className={CARD}>
          <div className={LABEL}>Events · 30 days</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {analytics?.totals.last_30_days ?? "—"}
          </div>
        </div>
      </div>

      <div className={CARD}>
        <h2 className="text-lg font-semibold text-slate-900">Top events (7 days)</h2>
        {topEvents.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No events yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            {topEvents.map(([name, count]) => (
              <li key={name} className="flex justify-between gap-3">
                <span className="font-mono text-xs">{name}</span>
                <span className="font-semibold">{count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`${CARD} block transition hover:border-slate-300 hover:shadow`}
          >
            <div className="font-semibold text-slate-900">{link.title}</div>
            <div className="mt-1 text-sm text-slate-500">{link.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function SiteCmsDashboardPage() {
  return (
    <AdminGate requiredPermission="marketing.read">
      <SiteDashboardInner />
    </AdminGate>
  );
}
