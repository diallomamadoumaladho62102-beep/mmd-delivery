"use client";


import { useAdminT } from "@/i18n/useAdminT";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

const CARD = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";

type Subscriber = {
  id: string;
  email: string;
  locale: string;
  source: string;
  status: string;
  created_at: string;
};

function NewsletterInner() {
  const { t } = useAdminT();

  const [rows, setRows] = useState<Subscriber[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    await resolveBrowserStaffSession();
    const http = await adminFetch("/api/admin/site/newsletter?limit=500");
    const res = (await http.json().catch(() => ({}))) as Record<string, unknown>;
    if (!http.ok || res.ok === false) {
      setError(String(res.error ?? "Load failed"));
      return;
    }
    setRows((res.subscribers as Subscriber[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <Link href="/admin/site" className="text-sm font-semibold text-slate-500 hover:text-slate-800">
          ← Corporate Website
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">{t("Newsletter subscribers")}</h1>
        <p className="mt-1 text-sm text-slate-600">{rows.length} subscriber(s)</p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      ) : null}

      <div className={`${CARD} overflow-x-auto`}>
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <th className="px-2 py-2">{t("Email")}</th>
              <th className="px-2 py-2">{t("Status")}</th>
              <th className="px-2 py-2">{t("Source")}</th>
              <th className="px-2 py-2">{t("Locale")}</th>
              <th className="px-2 py-2">{t("Joined")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="px-2 py-2 font-medium text-slate-900">{row.email}</td>
                <td className="px-2 py-2">{row.status}</td>
                <td className="px-2 py-2">{row.source}</td>
                <td className="px-2 py-2">{row.locale}</td>
                <td className="px-2 py-2 text-slate-500">
                  {new Date(row.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="p-2 text-sm text-slate-500">{t("No subscribers.")}</p> : null}
      </div>
    </div>
  );
}

export default function SiteNewsletterPage() {
  const { t } = useAdminT();

  return (
    <AdminGate requiredPermission="marketing.read">
      <NewsletterInner />
    </AdminGate>
  );
}
