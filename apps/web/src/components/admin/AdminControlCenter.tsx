"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import AdminCommissionsTable from "@/components/AdminCommissionsTable";
import AdminMmdAiSummary from "@/components/admin/AdminMmdAiSummary";
import AdminRefundBackfillPanel from "@/components/AdminRefundBackfillPanel";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { ADMIN_HUB_LINKS } from "@/lib/adminHubLinks";
import {
  effectiveStaffRole,
  hasPermission,
  roleDisplayName,
} from "@/lib/adminRbac";
import { supabase } from "@/lib/supabaseBrowser";
import { type UserRole } from "@/lib/roles";

type OverviewMetrics = {
  pending_orders: number;
  online_drivers: number;
  unpaid_orders: number;
  failed_payouts: number;
  pending_dispatch_retries: number;
  webhooks_24h: number;
};

export default function AdminControlCenter() {
  const [role, setRole] = useState<UserRole>(null);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid || !alive) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_founder")
        .eq("id", uid)
        .maybeSingle();

      if (!alive) return;
      const effectiveRole = effectiveStaffRole({
        role: profile?.role,
        isFounder: profile?.is_founder === true,
      });
      setRole(effectiveRole);

      if (!effectiveRole || !hasPermission(effectiveRole, "supervision.read")) {
        return;
      }

      const res = await adminFetch("/api/admin/overview");
      const body = await res.json().catch(() => ({}));
      if (!alive) return;

      if (!res.ok || !body.ok) {
        setMetricsError(body.error ?? "Impossible de charger la supervision");
        return;
      }

      setMetrics(body.metrics as OverviewMetrics);
    })();

    return () => {
      alive = false;
    };
  }, []);

  const visibleLinks = useMemo(() => {
    if (!role) return [];
    return ADMIN_HUB_LINKS.filter((link) => hasPermission(role, link.permission));
  }, [role]);

  const launchClusterHrefs = useMemo(
    () =>
      new Set([
        "/admin/taxi-monitoring",
        "/admin/taxi-launch",
        "/admin/platform-launch",
        "/admin/mmd-ai",
        "/admin/mmd-ai/launch",
      ]),
    []
  );

  const launchClusterLinks = useMemo(
    () => visibleLinks.filter((link) => launchClusterHrefs.has(link.href)),
    [launchClusterHrefs, visibleLinks]
  );

  const primaryLinks = useMemo(
    () => visibleLinks.filter((link) => !launchClusterHrefs.has(link.href)),
    [launchClusterHrefs, visibleLinks]
  );

  return (
    <AdminGate requiredPermission="hub.access">
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          <header className="space-y-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · Control Center
            </div>

            <div>
              <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                Centre de contrôle opérationnel
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Supervision nationale : utilisateurs, commandes, dispatch, paiements et
                audit — piloté par rôles RBAC (
                {role ? roleDisplayName(role) : "…"}).
              </p>
            </div>
          </header>

          {metrics ? (
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Commandes en attente", value: metrics.pending_orders },
                { label: "Chauffeurs en ligne", value: metrics.online_drivers },
                { label: "Non payées", value: metrics.unpaid_orders },
                { label: "Payouts échoués", value: metrics.failed_payouts },
                { label: "Dispatch retries", value: metrics.pending_dispatch_retries },
                { label: "Webhooks 24h", value: metrics.webhooks_24h },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="mt-1 text-2xl font-bold text-slate-900">
                    {item.value}
                  </div>
                </div>
              ))}
            </section>
          ) : metricsError ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              {metricsError}
            </div>
          ) : null}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {primaryLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50"
              >
                <div className="font-medium text-slate-900">{link.title}</div>
                <div className="mt-1 text-sm text-slate-500">{link.description}</div>
              </Link>
            ))}
          </section>

          {launchClusterLinks.length ? (
            <section className="space-y-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Launch, monitoring & MMD AI
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Regional rollout, taxi ops monitoring, platform launch, and MMD AI controls.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {launchClusterLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:bg-slate-50"
                  >
                    <div className="font-medium text-slate-900">{link.title}</div>
                    <div className="mt-1 text-sm text-slate-500">{link.description}</div>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {role ? <AdminMmdAiSummary role={role} /> : null}

          {role && hasPermission(role, "payouts.read") ? (
            <AdminRefundBackfillPanel />
          ) : null}

          {role && hasPermission(role, "commissions.read") ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Commissions récentes
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Vue finance / super admin des commissions calculées.
                  </p>
                </div>
                <a
                  href="/admin/commission-engine"
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Moteur de commissions
                </a>
                {role && hasPermission(role, "analytics.read") ? (
                  <a
                    href="/admin/analytics"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Analytics
                  </a>
                ) : null}
              </div>
              <AdminCommissionsTable />
            </section>
          ) : null}
        </div>
      </main>
    </AdminGate>
  );
}
