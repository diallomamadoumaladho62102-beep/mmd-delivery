"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { canManageMmdAi } from "@/lib/adminAccess";

type ControlSnapshot = {
  globalEnabled: boolean;
  emergencyStop: boolean;
  emergencyStopEnv: boolean;
  emergencyStopDb: boolean;
  costTodayUsd: number;
  costCapUsd: number | null;
  costCapEnvUsd: number | null;
  costCapDbUsd: number | null;
  activeRegions: number;
  internalBetaUserCount: number;
  metricsToday: Record<string, unknown> | null;
};

type MetricsPayload = {
  metrics?: Record<string, unknown>;
  geo?: {
    by_country?: Array<Record<string, unknown>>;
    by_state?: Array<Record<string, unknown>>;
  };
  topIntents?: Array<{ intent?: string; count?: number }>;
  control?: ControlSnapshot;
};

function formatUsd(value: unknown) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "$0.00";
  return `$${num.toFixed(4)}`;
}

function formatInt(value: unknown) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num.toLocaleString() : "0";
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

export default function AdminMmdAiPage() {
  const [period, setPeriod] = useState<"today" | "7d" | "30d">("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<MetricsPayload | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load(nextPeriod = period) {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMmdAi(session?.role ?? null));

    const res = await adminFetch(`/api/admin/mmd-ai/metrics?period=${nextPeriod}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Unable to load MMD AI metrics");
      setLoading(false);
      return;
    }
    setPayload(body as MetricsPayload);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [period]);

  async function toggleEmergencyStop(enabled: boolean) {
    setSaving(true);
    const res = await adminFetch("/api/admin/mmd-ai/control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emergency_stop: enabled }),
    });
    const body = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Unable to update emergency stop");
      return;
    }
    await load();
  }

  const metrics = payload?.metrics ?? {};
  const control = payload?.control;

  return (
    <AdminGate requiredPermission="mmd_ai.read">
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          <header className="space-y-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · MMD AI
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">MMD AI</h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Monitoring, coût estimé OpenAI, escalations et launch control par marché.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/admin/mmd-ai/launch"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Launch Control
                </Link>
                <Link
                  href="/admin"
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Control Center
                </Link>
              </div>
            </div>
          </header>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <MetricCard
              label="Global Enabled"
              value={control?.globalEnabled ? "ON" : "OFF"}
            />
            <MetricCard
              label="Emergency Stop"
              value={control?.emergencyStop ? "ACTIVE" : "Off"}
            />
            <MetricCard label="Cost Today" value={formatUsd(control?.costTodayUsd)} />
            <MetricCard
              label="Cost Cap"
              value={control?.costCapUsd != null ? formatUsd(control.costCapUsd) : "None"}
            />
            <MetricCard label="Active Regions" value={formatInt(control?.activeRegions)} />
            <MetricCard
              label="Internal Beta Users"
              value={formatInt(control?.internalBetaUserCount)}
            />
          </section>

          {canEdit ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-semibold text-slate-900">Ops controls</h2>
              <p className="mt-1 text-sm text-slate-500">
                Emergency stop via Admin (env `AI_EMERGENCY_STOP` overrides and locks UI).
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={saving || control?.emergencyStopEnv}
                  onClick={() => void toggleEmergencyStop(true)}
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                >
                  Activate Emergency Stop
                </button>
                <button
                  type="button"
                  disabled={saving || control?.emergencyStopEnv || !control?.emergencyStopDb}
                  onClick={() => void toggleEmergencyStop(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 disabled:opacity-50"
                >
                  Release Admin Stop
                </button>
              </div>
            </section>
          ) : null}

          <section className="flex flex-wrap gap-2">
            {(["today", "7d", "30d"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPeriod(item)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  period === item
                    ? "bg-slate-900 text-white"
                    : "border border-slate-200 bg-white text-slate-700"
                }`}
              >
                {item === "today" ? "Today" : item === "7d" ? "Last 7 days" : "Last 30 days"}
              </button>
            ))}
          </section>

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
              Loading metrics…
            </div>
          ) : (
            <>
              <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <MetricCard
                  label="Conversations"
                  value={formatInt(metrics.ai_conversations_count)}
                />
                <MetricCard label="Messages" value={formatInt(metrics.ai_messages_count)} />
                <MetricCard label="Unique users" value={formatInt(metrics.ai_unique_users)} />
                <MetricCard label="Escalations" value={formatInt(metrics.ai_escalation_count)} />
                <MetricCard label="Errors" value={formatInt(metrics.ai_error_count)} />
              </section>

              <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-slate-900">Estimated OpenAI cost</h2>
                  <div className="mt-3 text-3xl font-black text-emerald-700">
                    {formatUsd(metrics.estimated_cost_usd)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h2 className="text-base font-semibold text-slate-900">Top intents</h2>
                  <ul className="mt-3 space-y-2 text-sm">
                    {(payload?.topIntents ?? []).length ? (
                      (payload?.topIntents ?? []).map((row) => (
                        <li
                          key={String(row.intent)}
                          className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2"
                        >
                          <span className="font-medium text-slate-800">{row.intent}</span>
                          <span className="text-slate-500">{formatInt(row.count)}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-slate-500">No intent data yet.</li>
                    )}
                  </ul>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <GeoTable
                  title="Conversations by country"
                  subtitle="Estimated cost by country"
                  rows={payload?.geo?.by_country ?? []}
                />
                <GeoTable
                  title="Conversations by state / region"
                  subtitle="Estimated cost by state"
                  rows={payload?.geo?.by_state ?? []}
                  showState
                />
              </section>
            </>
          )}
        </div>
      </main>
    </AdminGate>
  );
}

function GeoTable({
  title,
  subtitle,
  rows,
  showState = false,
}: {
  title: string;
  subtitle: string;
  rows: Array<Record<string, unknown>>;
  showState?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-4">Country</th>
              {showState ? <th className="py-2 pr-4">State/Region</th> : null}
              <th className="py-2 pr-4">Conv.</th>
              <th className="py-2 pr-4">Msgs</th>
              <th className="py-2">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={`${row.country_code}-${row.state_or_region}-${index}`} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    {String(row.country_code ?? "—")}
                  </td>
                  {showState ? (
                    <td className="py-2 pr-4 text-slate-700">
                      {String(row.state_or_region ?? "—")}
                    </td>
                  ) : null}
                  <td className="py-2 pr-4">{formatInt(row.conversations)}</td>
                  <td className="py-2 pr-4">{formatInt(row.messages)}</td>
                  <td className="py-2">{formatUsd(row.estimated_cost_usd)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={showState ? 5 : 4} className="py-4 text-slate-500">
                  No geo data yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
