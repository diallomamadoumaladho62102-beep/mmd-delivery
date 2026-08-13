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
import AdminOpsLiveMap from "@/components/admin/AdminOpsLiveMap";

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

      // Recent activity: real admin_audit_logs only — never invent events.
      let nextActivity: ActivityItem[] = [];
      if (
        sessionHasPermission(
          { role: effectiveRole, isFounder: founder },
          "audit.read"
        )
      ) {
        const { data: auditRows } = await supabase
          .from("admin_audit_logs")
          .select("id, action, target_type, created_at")
          .order("created_at", { ascending: false })
          .limit(8);
        if (Array.isArray(auditRows) && auditRows.length) {
          nextActivity = auditRows.map((row, i) => {
            const created =
              typeof row.created_at === "string" ? row.created_at : null;
            const time = created
              ? new Date(created).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
              : "—";
            const action = String(row.action ?? "admin_action");
            const target = row.target_type
              ? ` · ${String(row.target_type)}`
              : "";
            return {
              id: String(row.id ?? `audit-${i}`),
              time,
              label: `${action}${target}`,
            };
          });
        }
      }
      // Fallback: live overview metrics only (no fabricated audit rows).
      if (!nextActivity.length && loadedMetrics) {
        const stamp = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        nextActivity = [
          {
            id: "m-orders",
            time: stamp,
            label: `${loadedMetrics.pending_orders} open orders`,
          },
          {
            id: "m-drivers",
            time: stamp,
            label: `${loadedMetrics.online_drivers} active drivers`,
          },
        ];
      }
      if (alive) setActivity(nextActivity);
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

    // Figma Overview KPI row: Open orders · Active drivers · Critical flags · AI actions
    const cards: KpiCard[] = [
      {
        id: "open_orders",
        label: "Open orders",
        value: m?.pending_orders ?? "—",
        href: "/admin/orders",
        tone: "success",
        visible: showOps || showSupport,
      },
      {
        id: "active_drivers",
        label: "Active drivers",
        value: m?.online_drivers ?? "—",
        href: "/admin/drivers",
        tone: "info",
        visible: showOps || showSupport,
      },
      {
        id: "critical_flags",
        label: "Critical flags",
        value:
          m == null
            ? "—"
            : Number(m.failed_payouts ?? 0) +
              Number(m.pending_dispatch_retries ?? 0),
        href: "/admin/road-safety",
        tone: "critical",
        visible: showSafety || showOps || showFinance,
      },
      {
        id: "ai_actions",
        label: "AI actions",
        value: m?.webhooks_24h ?? "—",
        href: "/admin/mmd-ai",
        tone: "success",
        visible:
          persona === "founder" ||
          persona === "admin" ||
          persona === "finance" ||
          showOps,
      },
    ];
    return cards.filter((k) => k.visible);
  }, [m, persona]);

  const alerts = useMemo((): AlertCard[] => {
    const failed = m?.failed_payouts ?? 0;
    const pending = m?.pending_orders ?? 0;
    const dispatch = m?.pending_dispatch_retries ?? 0;
    // Only surface alerts backed by real overview metrics (no placeholder zeros).
    const cards: AlertCard[] = [
      {
        id: "payouts_failed",
        label: "Failed payouts",
        count: failed,
        href: "/admin/payouts",
        tone: "critical",
        visible:
          (persona === "founder" ||
            persona === "admin" ||
            persona === "finance" ||
            persona === "ops") &&
          failed > 0,
      },
      {
        id: "orders_blocked",
        label: "Open orders",
        count: pending,
        href: "/admin/orders",
        tone: "warn",
        visible: persona !== "finance" && pending > 0,
      },
      {
        id: "dispatch_retry",
        label: "Dispatch retries",
        count: dispatch,
        href: "/admin/dispatch",
        tone: "info",
        visible:
          (persona === "founder" || persona === "admin" || persona === "ops") &&
          dispatch > 0,
      },
    ];
    return cards.filter((a) => a.visible);
  }, [m, persona]);

  return (
    <div className="mx-auto max-w-[1280px] space-y-8 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[32px] font-bold tracking-tight text-white sm:text-[36px]">
            Overview
          </h1>
          <p className="mt-1 text-sm text-white/70">
            {roleDisplayName(role, { isFounder })}
            {persona !== "admin" && persona !== "founder"
              ? ` · ${persona} desk`
              : ""}
            {isFounder ? " · unrestricted access" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(251,191,36,0.25)] bg-[rgba(251,191,36,0.1)] px-3.5 py-2 text-sm font-bold text-[var(--cc-gold)]">
            <span aria-hidden>🛡️</span>
            {roleDisplayName(role, { isFounder })}
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
          <p className="w-full text-sm text-[var(--cc-critical)]">{metricsError}</p>
        ) : null}
      </header>

      {/* KPI row — Figma Overview */}
      <section aria-label="Key metrics">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <Link
              key={kpi.id}
              href={kpi.href}
              className="block rounded-[20px] border border-white/10 bg-white/[0.04] p-7 shadow-[0px_16px_32px_rgba(0,0,0,0.25)] backdrop-blur-[20px] transition hover:bg-white/[0.07]"
            >
              <p className="text-lg font-semibold text-white/70">{kpi.label}</p>
              <p className="mt-3 text-5xl font-bold text-white">{kpi.value}</p>
              <div className="mt-3 flex items-center gap-2.5">
                <span
                  className={`inline-block size-2.5 rounded-[5px] ${TONE_DOT[kpi.tone]}`}
                />
                <span className="text-base font-semibold text-white/80">
                  Live
                </span>
              </div>
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
          <AdminOpsLiveMap />
        </section>
      )}

      {/* Critical alerts — only when real counts exist */}
      {alerts.length > 0 ? (
        <section aria-label="Critical alerts" className="space-y-3">
          <h2 className="text-base font-semibold text-white">Critical alerts</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {alerts.map((alert) => (
              <Link
                key={alert.id}
                href={alert.href}
                className={`cc-card border-l-4 px-4 py-4 ${ALERT_BORDER[alert.tone]}`}
              >
                <p className="text-2xl font-semibold tracking-tight text-white">
                  {alert.count}
                </p>
                <p className="mt-1 text-sm text-[var(--cc-muted)]">{alert.label}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* My tasks */}
        <section aria-label="My tasks" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">My tasks</h2>
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
                  <span className="text-sm font-medium text-white">
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

        {/* Recent activity — Figma table */}
        <section aria-label="Recent activity" className="space-y-4 lg:col-span-2">
          <h2 className="text-2xl font-bold text-white">Recent activity</h2>
          <div className="overflow-hidden rounded-[20px] border border-white/10 bg-white/[0.04] shadow-[0px_18px_36px_-18px_rgba(0,0,0,0.25)] backdrop-blur-[20px]">
            <div className="grid grid-cols-2 gap-3 bg-white/[0.06] px-5 py-3.5 text-sm font-bold uppercase tracking-[0.08em] text-white/70 sm:grid-cols-4">
              <span>Time</span>
              <span className="sm:col-span-2">Event</span>
              <span className="hidden sm:block">Status</span>
            </div>
            {activity.length === 0 ? (
              <p className="px-5 py-6 text-sm text-white/70">
                Activity will appear here as admins take actions.
              </p>
            ) : (
              activity.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-2 gap-3 border-t border-white/[0.07] px-5 py-3.5 sm:grid-cols-4"
                >
                  <span className="text-base tabular-nums text-white">
                    {item.time}
                  </span>
                  <span className="text-base text-white sm:col-span-2">
                    {item.label}
                  </span>
                  <span className="hidden sm:inline-flex">
                    <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1.5 text-sm font-bold text-[#22C55E]">
                      Live
                    </span>
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
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
