"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import {
  resolveBrowserStaffSession,
} from "@/lib/adminBrowserAuth";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { roleDisplayName, STAFF_ROLES } from "@/lib/adminRbac";

type AdminRow = {
  id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  account_status: string;
  is_founder: boolean;
  created_at: string;
};

export default function AdminHrDashboardPage() {
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [tasksCount, setTasksCount] = useState({ total: 0, overdue: 0, open: 0 });
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const session = await resolveBrowserStaffSession();
      if (!alive) return;
      const ok = session?.isFounder === true || session?.role === "admin";
      setAllowed(ok);
      if (!ok) return;

      const [adminsRes, tasksRes] = await Promise.all([
        adminFetch("/api/admin/admins"),
        adminFetch("/api/admin/tasks"),
      ]);
      const adminsBody = await adminsRes.json().catch(() => ({}));
      if (adminsBody.ok) setRows(adminsBody.items ?? []);
      const tasksBody = await tasksRes.json().catch(() => ({}));
      if (tasksBody.ok) {
        const items = (tasksBody.items ?? []) as {
          status: string;
          due_at: string | null;
        }[];
        const open = items.filter(
          (t) => !["done", "cancelled"].includes(t.status)
        ).length;
        const overdue = items.filter(
          (t) =>
            t.due_at &&
            new Date(t.due_at).getTime() < Date.now() &&
            !["done", "cancelled"].includes(t.status)
        ).length;
        setTasksCount({ total: items.length, open, overdue });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stats = useMemo(() => {
    const total = rows.length;
    const active = rows.filter((r) => r.account_status === "active").length;
    const suspended = rows.filter((r) => r.account_status === "suspended").length;
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newHires = rows.filter(
      (r) => r.created_at && new Date(r.created_at).getTime() >= weekAgo
    ).length;
    const byRole = STAFF_ROLES.map((role) => ({
      role,
      count: rows.filter((r) => r.role === role).length,
    }));
    return { total, active, suspended, offline: total - active, newHires, byRole };
  }, [rows]);

  if (allowed === false) {
    return (
      <AdminGate requiredPermission="users.admins.manage">
        <div className="cc-card mx-auto max-w-lg p-6">
          <h1 className="text-lg font-semibold text-slate-900">Founder only</h1>
          <p className="mt-2 text-sm text-[var(--cc-muted)]">
            The People Ops dashboard is reserved for the Founder (and Super Admin
            operators acting under Founder authority).
          </p>
          <Link
            href="/admin"
            className="mt-4 inline-block text-sm font-semibold text-[var(--cc-info)]"
          >
            Back to dashboard
          </Link>
        </div>
      </AdminGate>
    );
  }

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
              Organization health · workload · staffing
            </p>
          </div>
          <Link
            href="/admin/staff"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Manage staff
          </Link>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Administrators", value: stats.total, tone: "info" },
            { label: "Active", value: stats.active, tone: "success" },
            { label: "Offline / other", value: stats.offline, tone: "neutral" },
            { label: "Suspended", value: stats.suspended, tone: "critical" },
            { label: "New (7 days)", value: stats.newHires, tone: "ai" },
            { label: "Open tasks", value: tasksCount.open, tone: "warn" },
            { label: "Overdue tasks", value: tasksCount.overdue, tone: "critical" },
            { label: "Tasks total", value: tasksCount.total, tone: "info" },
          ].map((kpi) => (
            <div key={kpi.label} className="cc-kpi">
              <p className="cc-kpi-label">{kpi.label}</p>
              <p className="cc-kpi-value">{allowed === null ? "—" : kpi.value}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="cc-card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Roles distribution</h2>
            <ul className="mt-4 space-y-3">
              {stats.byRole.map((item) => (
                <li
                  key={item.role}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-slate-700">{roleDisplayName(item.role)}</span>
                  <span className="font-semibold text-slate-900">{item.count}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="cc-card p-5">
            <h2 className="text-sm font-semibold text-slate-900">Workload snapshot</h2>
            <ul className="mt-4 divide-y divide-[var(--cc-border)]">
              {rows.slice(0, 8).map((row) => (
                <li key={row.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link
                      href={`/admin/staff/${row.id}`}
                      className="text-sm font-medium text-slate-900 hover:text-[var(--cc-info)]"
                    >
                      {row.full_name || row.email}
                    </Link>
                    <p className="text-xs text-[var(--cc-muted)]">
                      {roleDisplayName(row.role as never, {
                        isFounder: row.is_founder,
                      })}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[var(--cc-muted)]">
                    {row.account_status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </AdminGate>
  );
}
