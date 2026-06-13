"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { hasPermission } from "@/lib/adminRbac";
import type { UserRole } from "@/lib/roles";

type ControlSnapshot = {
  globalEnabled: boolean;
  emergencyStop: boolean;
  costTodayUsd: number;
  costCapUsd: number | null;
  activeRegions: number;
  metricsToday?: {
    ai_messages_count?: number;
    ai_error_count?: number;
  } | null;
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

export default function AdminMmdAiSummary({ role }: { role: UserRole }) {
  const [control, setControl] = useState<ControlSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!role || !hasPermission(role, "mmd_ai.read")) return;

    let alive = true;
    void (async () => {
      const res = await adminFetch("/api/admin/mmd-ai/control");
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok || !body.ok) {
        setError(body.error ?? "MMD AI metrics unavailable");
        return;
      }
      setControl(body.control as ControlSnapshot);
    })();

    return () => {
      alive = false;
    };
  }, [role]);

  if (!role || !hasPermission(role, "mmd_ai.read")) return null;

  const metrics = control?.metricsToday ?? {};

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">MMD AI</h2>
          <p className="mt-1 text-sm text-slate-500">
            Compact monitoring for usage, safety controls, and launch status.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin/mmd-ai"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Dashboard
          </Link>
          <Link
            href="/admin/mmd-ai/launch"
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            Launch Control
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {error}
        </div>
      ) : control ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          <SummaryCard label="Global Enabled" value={control.globalEnabled ? "ON" : "OFF"} />
          <SummaryCard
            label="Emergency Stop"
            value={control.emergencyStop ? "ACTIVE" : "Off"}
            alert={control.emergencyStop}
          />
          <SummaryCard label="Cost Today" value={formatUsd(control.costTodayUsd)} />
          <SummaryCard
            label="Cost Cap"
            value={control.costCapUsd != null ? formatUsd(control.costCapUsd) : "None"}
          />
          <SummaryCard label="Active Regions" value={formatInt(control.activeRegions)} />
          <SummaryCard label="Messages Today" value={formatInt(metrics.ai_messages_count)} />
          <SummaryCard label="Errors Today" value={formatInt(metrics.ai_error_count)} />
        </div>
      ) : (
        <p className="text-sm text-slate-500">Loading MMD AI summary…</p>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        alert ? "border-red-200 bg-red-50" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${alert ? "text-red-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}
