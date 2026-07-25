"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import {
  adminFetch,
  resolveBrowserStaffSession,
} from "@/lib/adminBrowserAuth";
import { roleDisplayName } from "@/lib/adminRbac";

type HrPayload = {
  totals: {
    admins: number;
    online: number;
    overdue_tasks: number;
    activity_7d: number;
  };
  by_department: Array<{
    key: string;
    people: number;
    tasks_done: number;
    workload: number;
    activity_7d: number;
  }>;
  by_country: Array<{
    key: string;
    people: number;
    tasks_done: number;
    workload: number;
    activity_7d: number;
  }>;
  by_region: Array<{
    key: string;
    people: number;
    activity_7d: number;
  }>;
  top_performers: Array<{
    admin_id: string;
    success_rate: number;
    tasks_done: number;
  }>;
  needs_attention: Array<{
    admin_id: string;
    tasks_overdue: number;
    success_rate: number;
  }>;
};

type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_founder: boolean;
  presence_status?: string | null;
  staff_country_code?: string | null;
  performance?: { workload: number; success_rate: number; tasks_overdue: number } | null;
};

export default function AdminHrDashboardPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [hr, setHr] = useState<HrPayload | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await resolveBrowserStaffSession();
      if (!alive) return;
      const ok = session?.isFounder === true || session?.role === "admin";
      setAllowed(ok);
      if (!ok) return;

      const res = await adminFetch("/api/admin/staff/performance");
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Failed to load People Ops");
        return;
      }
      setHr(body.hr ?? null);
      setPeople(body.items ?? []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (allowed === false) {
    return (
      <AdminGate requiredPermission="users.admins.manage">
        <div className="cc-card mx-auto max-w-lg p-6">
          <h1 className="text-lg font-semibold text-slate-900">Founder only</h1>
          <p className="mt-2 text-sm text-[var(--cc-muted)]">
            People Ops is reserved for the Founder and Super Admin.
          </p>
        </div>
      </AdminGate>
    );
  }

  const nameById = new Map(
    people.map((p) => [p.id, p.full_name || p.email || p.id.slice(0, 8)])
  );

  return (
    <AdminGate requiredPermission="users.admins.manage">
      <div className="mx-auto max-w-[1400px] space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-ai)]">
              Founder
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
              People Ops
            </h1>
            <p className="mt-1 text-sm text-[var(--cc-muted)]">
              Live performance from tasks + admin audit logs
            </p>
          </div>
          <Link
            href="/admin/staff"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Manage staff
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Administrators", hr?.totals.admins],
            ["Online now", hr?.totals.online],
            ["Overdue tasks", hr?.totals.overdue_tasks],
            ["Activity 7d", hr?.totals.activity_7d],
          ].map(([label, value]) => (
            <div key={String(label)} className="cc-kpi">
              <p className="cc-kpi-label">{label}</p>
              <p className="cc-kpi-value">{value ?? "—"}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <AggCard title="By department" rows={hr?.by_department ?? []} />
          <AggCard title="By country" rows={hr?.by_country ?? []} />
          <AggCard title="By region" rows={hr?.by_region ?? []} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="cc-card p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Top performers
            </h2>
            <ul className="mt-3 divide-y divide-[var(--cc-border)]">
              {(hr?.top_performers ?? []).map((row) => (
                <li key={row.admin_id} className="flex justify-between py-2 text-sm">
                  <Link
                    href={`/admin/staff/${row.admin_id}`}
                    className="font-medium text-[var(--cc-info)]"
                  >
                    {nameById.get(row.admin_id) ?? row.admin_id.slice(0, 8)}
                  </Link>
                  <span>
                    {row.success_rate}% · {row.tasks_done} done
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="cc-card p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              Needs attention
            </h2>
            <ul className="mt-3 divide-y divide-[var(--cc-border)]">
              {(hr?.needs_attention ?? []).map((row) => (
                <li key={row.admin_id} className="flex justify-between py-2 text-sm">
                  <Link
                    href={`/admin/staff/${row.admin_id}`}
                    className="font-medium text-[var(--cc-critical)]"
                  >
                    {nameById.get(row.admin_id) ?? row.admin_id.slice(0, 8)}
                  </Link>
                  <span>
                    {row.tasks_overdue} overdue · {row.success_rate}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="cc-card overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--cc-border)] bg-slate-50 text-xs uppercase text-[var(--cc-muted)]">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Presence</th>
                <th className="px-4 py-3">Workload</th>
                <th className="px-4 py-3">Success</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/staff/${p.id}`}
                      className="font-medium text-slate-900 hover:text-[var(--cc-info)]"
                    >
                      {p.full_name || p.email}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {roleDisplayName(p.role as never, {
                      isFounder: p.is_founder,
                    })}
                  </td>
                  <td className="px-4 py-3">{p.staff_country_code || "—"}</td>
                  <td className="px-4 py-3">{p.presence_status || "offline"}</td>
                  <td className="px-4 py-3">{p.performance?.workload ?? 0}</td>
                  <td className="px-4 py-3">
                    {p.performance?.success_rate ?? 0}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminGate>
  );
}

function AggCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; people: number; activity_7d?: number }>;
}) {
  return (
    <div className="cc-card p-5">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      <ul className="mt-3 space-y-2 text-sm">
        {rows.slice(0, 8).map((row) => (
          <li key={row.key} className="flex justify-between">
            <span>{row.key}</span>
            <span className="text-[var(--cc-muted)]">
              {row.people} people
              {row.activity_7d != null ? ` · ${row.activity_7d} acts` : ""}
            </span>
          </li>
        ))}
        {!rows.length ? (
          <li className="text-[var(--cc-muted)]">No data yet</li>
        ) : null}
      </ul>
    </div>
  );
}
