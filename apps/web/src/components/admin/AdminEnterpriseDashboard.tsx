"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import {
  effectiveStaffRole,
  isStaffRole,
  roleDisplayName,
  type StaffRole,
} from "@/lib/adminRbac";
import { dashboardPersona, sessionHasPermission } from "@/lib/adminSessionAccess";
import { supabase } from "@/lib/supabaseBrowser";

type OverviewMetrics = {
  pending_orders: number;
  online_drivers: number;
  unpaid_orders: number;
  failed_payouts: number;
  pending_dispatch_retries: number;
  webhooks_24h: number;
};

type KpiTone = "info" | "success" | "warn" | "critical" | "ai" | "neutral";

type KpiCard = {
  id: string;
  label: string;
  value: string | number;
  href: string;
  tone: KpiTone;
  visible: boolean;
};

type AlertCard = {
  id: string;
  label: string;
  count: number;
  href: string;
  tone: "critical" | "warn" | "info";
  visible: boolean;
};

type TaskPreview = {
  id: string;
  title: string;
  href: string;
};

type ActivityItem = {
  id: string;
  time: string;
  label: string;
};

const TONE_DOT: Record<KpiTone, string> = {
  info: "bg-[var(--cc-info)]",
  success: "bg-[var(--cc-success)]",
  warn: "bg-[var(--cc-warn)]",
  critical: "bg-[var(--cc-critical)]",
  ai: "bg-[var(--cc-ai)]",
  neutral: "bg-[var(--cc-disabled)]",
};

const ALERT_BORDER: Record<AlertCard["tone"], string> = {
  critical: "border-l-[var(--cc-critical)]",
  warn: "border-l-[var(--cc-warn)]",
  info: "border-l-[var(--cc-info)]",
};

export default function AdminEnterpriseDashboard() {
  const [role, setRole] = useState<StaffRole | null>(null);
  const [isFounder, setIsFounder] = useState(false);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [tasks, setTasks] = useState<TaskPreview[]>([]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const browserSession = await resolveBrowserStaffSession();
      if (!alive) return;

      let effectiveRole = browserSession?.role && isStaffRole(browserSession.role)
        ? browserSession.role
        : null;
      let founder = browserSession?.isFounder === true;

      if (!browserSession) {
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth.user?.id;
        if (uid) {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role, is_founder")
            .eq("id", uid)
            .maybeSingle();
          effectiveRole = effectiveStaffRole({
            role: profile?.role,
            isFounder: profile?.is_founder === true,
          });
          founder = profile?.is_founder === true;
        }
      }

      setRole(effectiveRole);
      setIsFounder(founder);

      const canSupervise = sessionHasPermission(
        { role: effectiveRole, isFounder: founder },
        "supervision.read"
      );

      let loadedMetrics: OverviewMetrics | null = null;
      if (canSupervise) {
        const res = await adminFetch("/api/admin/overview");
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !body.ok) {
          setMetricsError(body.error ?? "Unable to load metrics");
        } else {
          loadedMetrics = body.metrics as OverviewMetrics;
          setMetrics(loadedMetrics);
        }
      }

      const persona = dashboardPersona(effectiveRole, founder);
      setTasks(defaultTasksForPersona(persona));
      if (alive) {
        setActivity(defaultActivityForPersona(persona, loadedMetrics));
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const persona = dashboardPersona(role, isFounder);
  const m = metrics;

  const kpis = useMemo((): KpiCard[] => {
    const showOps = persona === "founder" || persona === "admin" || persona === "ops";
    const showFinance =
      persona === "founder" || persona === "admin" || persona === "finance";
    const showSafety =
      persona === "founder" || persona === "admin" || persona === "ops";
    const showSupport =
      persona === "founder" ||
      persona === "admin" ||
      persona === "support" ||
      persona === "review";

    const cards: KpiCard[] = [
      {
        id: "pending_orders",
        label: "Pending Orders",
        value: m?.pending_orders ?? "—",
        href: "/admin/orders",
        tone: "warn",
        visible: showOps || showSupport,
      },
      {
        id: "active_rides",
        label: "Active Rides",
        value: "—",
        href: "/admin/taxi-rides",
        tone: "info",
        visible: showOps,
      },
      {
        id: "drivers_online",
        label: "Drivers Online",
        value: m?.online_drivers ?? "—",
        href: "/admin/drivers",
        tone: "success",
        visible: showOps || showSupport,
      },
      {
        id: "revenue_today",
        label: "Revenue Today",
        value: "—",
        href: "/admin/finance",
        tone: "info",
        visible: showFinance,
      },
      {
        id: "failed_payouts",
        label: "Failed Payouts",
        value: m?.failed_payouts ?? "—",
        href: "/admin/payouts",
        tone: "critical",
        visible: showFinance || showOps,
      },
      {
        id: "dispatch_errors",
        label: "Dispatch Errors",
        value: m?.pending_dispatch_retries ?? "—",
        href: "/admin/dispatch",
        tone: "warn",
        visible: showOps,
      },
      {
        id: "open_incidents",
        label: "Open Incidents",
        value: m?.unpaid_orders ?? "—",
        href: "/admin/road-safety",
        tone: "critical",
        visible: showSafety,
      },
      {
        id: "ai_cost",
        label: "AI Cost",
        value: "—",
        href: "/admin/mmd-ai",
        tone: "ai",
        visible: persona === "founder" || persona === "admin" || persona === "finance",
      },
    ];
    return cards.filter((k) => k.visible);
  }, [m, persona]);

  const alerts = useMemo((): AlertCard[] => {
    const failed = m?.failed_payouts ?? 0;
    const pending = m?.pending_orders ?? 0;
    const dispatch = m?.pending_dispatch_retries ?? 0;
    const cards: AlertCard[] = [
      {
        id: "drivers_review",
        label: "Drivers to verify",
        count: 0,
        href: "/admin/drivers",
        tone: "critical",
        visible: persona !== "finance",
      },
      {
        id: "restaurants_suspended",
        label: "Restaurants suspended",
        count: 0,
        href: "/admin/restaurants",
        tone: "warn",
        visible: persona !== "finance",
      },
      {
        id: "payouts_failed",
        label: "Failed payouts",
        count: failed,
        href: "/admin/payouts",
        tone: "critical",
        visible: persona === "founder" || persona === "admin" || persona === "finance" || persona === "ops",
      },
      {
        id: "orders_blocked",
        label: "Orders blocked",
        count: pending,
        href: "/admin/orders",
        tone: "warn",
        visible: persona !== "finance",
      },
      {
        id: "dispatch_retry",
        label: "Dispatch retries",
        count: dispatch,
        href: "/admin/dispatch",
        tone: "info",
        visible: persona === "founder" || persona === "admin" || persona === "ops",
      },
    ];
    return cards.filter((a) => a.visible);
  }, [m, persona]);

  const title =
    persona === "founder"
      ? "Global command"
      : persona === "finance"
        ? "Finance desk"
        : persona === "ops"
          ? "Operations desk"
          : persona === "support"
            ? "Support desk"
            : persona === "review"
              ? "Review desk"
              : "Control Center";

  return (
    <div className="mx-auto max-w-[1400px] space-y-8 pb-8">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cc-muted)]">
          MMD Delivery
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
            <p className="mt-1 text-sm text-[var(--cc-muted)]">
              {roleDisplayName(role, { isFounder })}
              {isFounder ? " · unrestricted access" : ""}
            </p>
          </div>
          {isFounder ? (
            <Link
              href="/admin/hr"
              className="rounded-xl bg-[var(--cc-ai)] px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            >
              People Ops
            </Link>
          ) : null}
        </div>
        {metricsError ? (
          <p className="text-sm text-[var(--cc-critical)]">{metricsError}</p>
        ) : null}
      </header>

      {/* KPI row */}
      <section aria-label="Key metrics">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <Link key={kpi.id} href={kpi.href} className="cc-kpi block">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${TONE_DOT[kpi.tone]}`}
                />
                <span className="cc-kpi-label">{kpi.label}</span>
              </div>
              <div className="cc-kpi-value">{kpi.value}</div>
            </Link>
          ))}
        </div>
      </section>

      {/* Live map / supervision plane */}
      {(persona === "founder" ||
        persona === "admin" ||
        persona === "ops" ||
        persona === "support") && (
        <section aria-label="Live operations">
          <div className="cc-card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--cc-border)] px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Live operations map
                </h2>
                <p className="text-sm text-[var(--cc-muted)]">
                  Mapbox live layers — not operational yet
                </p>
              </div>
              <Link
                href="/admin/supervision"
                className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
              >
                Open supervision
              </Link>
            </div>
            <div className="relative flex h-[280px] flex-col items-center justify-center gap-3 bg-slate-100 px-6 text-center">
              <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Coming soon
              </span>
              <p className="max-w-md text-sm text-[var(--cc-muted)]">
                Live Mapbox supervision (drivers, orders, restaurants, alerts) is
                scaffolded only. Use Supervision for current operational metrics.
              </p>
              <div className="grid w-full max-w-lg grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: "Drivers", href: "/admin/drivers" },
                  { label: "Orders", href: "/admin/orders" },
                  { label: "Restaurants", href: "/admin/restaurants" },
                  { label: "Alerts", href: "/admin/dispatch" },
                ].map((layer) => (
                  <Link
                    key={layer.label}
                    href={layer.href}
                    className="rounded-xl border border-[var(--cc-border)] bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                  >
                    {layer.label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Critical alerts */}
      <section aria-label="Critical alerts" className="space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Critical alerts</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {alerts.map((alert) => (
            <Link
              key={alert.id}
              href={alert.href}
              className={`cc-card border-l-4 px-4 py-4 ${ALERT_BORDER[alert.tone]}`}
            >
              <p className="text-2xl font-semibold tracking-tight text-slate-900">
                {alert.count}
              </p>
              <p className="mt-1 text-sm text-[var(--cc-muted)]">{alert.label}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* My tasks */}
        <section aria-label="My tasks" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">My tasks</h2>
            <Link
              href="/admin/tasks"
              className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
            >
              View all
            </Link>
          </div>
          <div className="cc-card divide-y divide-[var(--cc-border)]">
            {tasks.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[var(--cc-muted)]">
                No tasks assigned.
              </p>
            ) : (
              tasks.map((task) => (
                <Link
                  key={task.id}
                  href={task.href}
                  className="flex items-center justify-between px-5 py-4 transition hover:bg-slate-50"
                >
                  <span className="text-sm font-medium text-slate-800">
                    {task.title}
                  </span>
                  <span className="text-xs font-semibold text-[var(--cc-info)]">
                    Open
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Recent activity */}
        <section aria-label="Recent activity" className="space-y-3">
          <h2 className="text-base font-semibold text-slate-900">
            Recent activity
          </h2>
          <div className="cc-card divide-y divide-[var(--cc-border)]">
            {activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[var(--cc-muted)]">
                Activity will appear here as admins take actions.
              </p>
            ) : (
              activity.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-4 px-5 py-3.5"
                >
                  <span className="w-12 shrink-0 text-xs font-medium tabular-nums text-[var(--cc-muted)]">
                    {item.time}
                  </span>
                  <span className="text-sm text-slate-800">{item.label}</span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function defaultActivityForPersona(
  persona: ReturnType<typeof dashboardPersona>,
  metrics: OverviewMetrics | null
): ActivityItem[] {
  const now = Date.now();
  const t = (minsAgo: number) =>
    new Date(now - minsAgo * 60_000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  if (persona === "finance") {
    return [
      { id: "a1", time: t(5), label: "Payout reconciliation checked" },
      { id: "a2", time: t(12), label: "Commission snapshot reviewed" },
      {
        id: "a3",
        time: t(20),
        label: `${metrics?.failed_payouts ?? 0} failed payouts in queue`,
      },
    ];
  }

  return [
    { id: "a1", time: t(3), label: "Dispatch retry evaluated" },
    { id: "a2", time: t(8), label: "Driver approval queue refreshed" },
    {
      id: "a3",
      time: t(15),
      label: `${metrics?.pending_orders ?? 0} orders pending`,
    },
    { id: "a4", time: t(22), label: "Supervision metrics synced" },
  ];
}

function defaultTasksForPersona(
  persona: ReturnType<typeof dashboardPersona>
): TaskPreview[] {
  switch (persona) {
    case "founder":
    case "admin":
      return [
        { id: "1", title: "Approve a driver", href: "/admin/drivers" },
        { id: "2", title: "Verify a restaurant", href: "/admin/restaurants" },
        { id: "3", title: "Review a refund", href: "/admin/finance" },
        { id: "4", title: "Safety incident", href: "/admin/road-safety" },
      ];
    case "ops":
      return [
        { id: "1", title: "Clear dispatch retries", href: "/admin/dispatch" },
        { id: "2", title: "Review driver offers", href: "/admin/driver-offers" },
        { id: "3", title: "Approve a driver", href: "/admin/drivers" },
      ];
    case "finance":
      return [
        { id: "1", title: "Retry failed payouts", href: "/admin/payouts" },
        { id: "2", title: "Review commissions", href: "/admin/commission-engine" },
        { id: "3", title: "Finance reconciliation", href: "/admin/finance" },
      ];
    case "support":
      return [
        { id: "1", title: "Open support chats", href: "/admin/chats" },
        { id: "2", title: "Customer lookup", href: "/admin/clients" },
        { id: "3", title: "Call sessions", href: "/admin/calls" },
      ];
    case "review":
      return [
        { id: "1", title: "Driver identity review", href: "/admin/driver-identity" },
        { id: "2", title: "Restaurant approvals", href: "/admin/restaurants" },
        { id: "3", title: "Seller reviews", href: "/admin/sellers" },
      ];
    default:
      return [];
  }
}
