"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import {
  canManageTaxiAlerts,
} from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { readinessScoreColor } from "@/lib/taxiLaunchControl";

type AlertRow = {
  id: string;
  taxi_ride_id: string;
  alert_type: string;
  status: string;
  detected_at: string;
  metadata?: Record<string, unknown>;
};

type MonitoringPayload = {
  system_health?: Record<string, unknown> | null;
  dispatch_metrics?: Record<string, unknown> | null;
  payment_metrics?: Record<string, unknown> | null;
  market_metrics?: Array<Record<string, unknown>>;
  open_alerts?: {
    dispatch?: AlertRow[];
    payment?: AlertRow[];
    payout?: AlertRow[];
  };
};

function fmtMoney(cents: unknown) {
  const n = Number(cents ?? 0);
  return `$${(n / 100).toFixed(2)}`;
}

function scoreBadge(score: unknown) {
  const n = Number(score ?? 0);
  const color = readinessScoreColor(n);
  const cls =
    color === "green"
      ? "bg-emerald-100 text-emerald-800"
      : color === "orange"
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {n}/100
    </span>
  );
}

export default function AdminTaxiMonitoringPage() {
  const [data, setData] = useState<MonitoringPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [canResolve, setCanResolve] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanResolve(canManageTaxiAlerts(session?.role ?? null));
    const res = await adminFetch("/api/admin/taxi-monitoring");
    const body = await res.json().catch(() => ({}));
    setData(body);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolveAlert(
    alertTable: "dispatch" | "payment" | "payout",
    alertRow: AlertRow
  ) {
    if (!canResolve) return;
    setResolvingId(alertRow.id);
    try {
      const res = await adminFetch("/api/admin/taxi-alerts/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_id: alertRow.id,
          alert_table: alertTable,
          taxi_ride_id: alertRow.taxi_ride_id,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) window.alert(String(json.error ?? "Resolve failed"));
      else await load();
    } finally {
      setResolvingId(null);
    }
  }

  const health = data?.system_health ?? null;
  const alerts = data?.open_alerts ?? {};

  return (
    <AdminGate requiredPermission="taxi_monitoring.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Taxi Monitoring</h1>
              <p className="mt-1 text-sm text-slate-600">
                Santé système, KPI business, alertes opérationnelles.
              </p>
            </div>
            <a
              href="/admin/taxi-launch"
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
            >
              Launch Control →
            </a>
          </header>

          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <>
              <section className="grid gap-4 md:grid-cols-4">
                {(
                  [
                    ["Rides créées (24h)", health?.rides_created_24h],
                    ["Rides payées (24h)", health?.rides_paid_24h],
                    ["Dispatch OK (24h)", health?.dispatch_success_24h],
                    ["Dispatch KO (24h)", health?.dispatch_failed_24h],
                    ["Payout OK (24h)", health?.payout_success_24h],
                    ["Chauffeurs actifs", health?.active_drivers],
                    ["Chauffeurs dispo", health?.available_drivers],
                    [
                      "Acceptance rate",
                      health?.acceptance_rate != null
                        ? `${(Number(health.acceptance_rate) * 100).toFixed(1)}%`
                        : "—",
                    ],
                  ] as [string, string | number | null | undefined][]
                ).map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-900">
                      {value != null ? String(value) : "—"}
                    </p>
                  </div>
                ))}
              </section>

              <section className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-semibold text-slate-900">Revenue</h2>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Today</dt>
                      <dd className="font-medium">{fmtMoney(health?.revenue_today_cents)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Week</dt>
                      <dd className="font-medium">{fmtMoney(health?.revenue_week_cents)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Month</dt>
                      <dd className="font-medium">{fmtMoney(health?.revenue_month_cents)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Year</dt>
                      <dd className="font-medium">{fmtMoney(health?.revenue_year_cents)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="font-semibold text-slate-900">Business KPI (30d)</h2>
                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-slate-500">Premium drivers</dt>
                      <dd>{String(health?.drivers_premium ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">XL drivers</dt>
                      <dd>{String(health?.drivers_xl ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Shared rides</dt>
                      <dd>{String(health?.shared_rides_count_30d ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Shared discount</dt>
                      <dd>{fmtMoney(health?.shared_discount_cents_30d)}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Loyalty earned</dt>
                      <dd>{String(health?.loyalty_points_earned_30d ?? 0)} pts</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Promo redemptions</dt>
                      <dd>{String(health?.promo_redemptions_30d ?? 0)}</dd>
                    </div>
                  </dl>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="font-semibold text-slate-900">Market readiness</h2>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-slate-500">
                        <th className="py-2 pr-4">Pays</th>
                        <th className="py-2 pr-4">Score</th>
                        <th className="py-2 pr-4">Dispatch</th>
                        <th className="py-2 pr-4">Payment</th>
                        <th className="py-2 pr-4">Payout</th>
                        <th className="py-2 pr-4">Drivers</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data?.market_metrics ?? []).map((row) => (
                        <tr key={String(row.id)} className="border-b border-slate-100">
                          <td className="py-2 pr-4 font-medium">{String(row.country_code)}</td>
                          <td className="py-2 pr-4">{scoreBadge(row.readiness_score)}</td>
                          <td className="py-2 pr-4">{String(row.dispatch_readiness)}</td>
                          <td className="py-2 pr-4">{String(row.payment_readiness)}</td>
                          <td className="py-2 pr-4">{String(row.payout_readiness)}</td>
                          <td className="py-2 pr-4">{String(row.driver_supply)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {(["dispatch", "payment", "payout"] as const).map((kind) => (
                <section
                  key={kind}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <h2 className="font-semibold capitalize text-slate-900">
                    {kind} alerts ({(alerts[kind] ?? []).length})
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {(alerts[kind] ?? []).length === 0 ? (
                      <li className="text-sm text-slate-500">Aucune alerte ouverte</li>
                    ) : (
                      (alerts[kind] ?? []).map((alertRow) => (
                        <li
                          key={alertRow.id}
                          className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm"
                        >
                          <div>
                            <span className="font-medium">{alertRow.alert_type}</span>
                            <span className="ml-2 text-slate-500">
                              ride {alertRow.taxi_ride_id.slice(0, 8)} ·{" "}
                              {new Date(alertRow.detected_at).toLocaleString()}
                            </span>
                          </div>
                          {canResolve ? (
                            <button
                              type="button"
                              disabled={resolvingId === alertRow.id}
                              onClick={() => void resolveAlert(kind, alertRow)}
                              className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                            >
                              Resolve
                            </button>
                          ) : null}
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
