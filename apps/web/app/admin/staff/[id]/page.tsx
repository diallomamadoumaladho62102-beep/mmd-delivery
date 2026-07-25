"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";
import { isCcFeatureEnabled } from "@/lib/adminFeatureFlags";
import { roleDisplayName } from "@/lib/adminRbac";

type AdminRow = {
  id: string;
  role: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  account_status: string;
  is_founder: boolean;
  created_at: string;
};

export default function AdminStaffDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id ?? "");
  const [row, setRow] = useState<AdminRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await adminFetch("/api/admin/admins");
      const body = await res.json().catch(() => ({}));
      if (!alive) return;
      if (!res.ok || !body.ok) {
        setError(body.error ?? "Failed to load");
        return;
      }
      const found = (body.items as AdminRow[]).find((item) => item.id === id) ?? null;
      if (!found) setError("Administrator not found");
      setRow(found);
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const commsEnabled = isCcFeatureEnabled("staffRealtimeComms");
  const callsEnabled = isCcFeatureEnabled("staffAudioVideoCalls");
  const geoEnabled = isCcFeatureEnabled("staffGeoScopesUi");
  const perfEnabled = isCcFeatureEnabled("staffPerformanceMetrics");

  return (
    <AdminGate requiredPermission="users.admins.manage">
      <div className="mx-auto max-w-5xl space-y-6">
        <Link
          href="/admin/staff"
          className="text-sm font-semibold text-[var(--cc-info)] hover:underline"
        >
          ← Staff & Roles
        </Link>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !row ? (
          <p className="text-sm text-[var(--cc-muted)]">Loading…</p>
        ) : (
          <>
            <header className="cc-card flex flex-wrap items-center gap-4 p-6">
              <span className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-xl font-semibold text-slate-700">
                {(row.full_name || row.email || "?").slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                  {row.full_name ?? "Administrator"}
                </h1>
                <p className="text-sm text-[var(--cc-muted)]">
                  {roleDisplayName(row.role as never, { isFounder: row.is_founder })}
                  {" · "}
                  {row.account_status}
                </p>
              </div>
            </header>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="cc-card space-y-3 p-5">
                <h2 className="text-sm font-semibold text-slate-900">Information</h2>
                <Info label="Email" value={row.email} />
                <Info label="Phone" value={row.phone} />
                <Info
                  label="Role"
                  value={roleDisplayName(row.role as never, {
                    isFounder: row.is_founder,
                  })}
                />
                <Info
                  label="Created"
                  value={
                    row.created_at
                      ? new Date(row.created_at).toLocaleString()
                      : null
                  }
                />
                <Info
                  label="Geo scopes"
                  value={
                    geoEnabled
                      ? "Configured scopes"
                      : "Coming soon — geo assignment UI not wired"
                  }
                />
              </section>

              <section className="cc-card space-y-3 p-5">
                <h2 className="text-sm font-semibold text-slate-900">Performance</h2>
                {!perfEnabled ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-[var(--cc-muted)]">
                    Coming soon — staff performance metrics are not operational yet.
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-3 opacity-60">
                  {[
                    ["Tasks done", "—"],
                    ["Overdue", "—"],
                    ["Drivers approved", "—"],
                    ["Incidents handled", "—"],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-[var(--cc-border)] bg-slate-50 px-3 py-3"
                    >
                      <p className="text-xs text-[var(--cc-muted)]">{label}</p>
                      <p className="mt-1 text-lg font-semibold text-slate-900">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="cc-card space-y-4 p-5">
              <h2 className="text-sm font-semibold text-slate-900">
                Internal communication
              </h2>
              <p className="text-sm text-[var(--cc-muted)]">
                Coming soon — realtime staff messaging and calls are not wired.
                Actions below are disabled to avoid false success.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  ["Private message", commsEnabled],
                  ["Open conversation", commsEnabled],
                  ["Audio call", callsEnabled],
                  ["Video call", callsEnabled],
                  ["Schedule meeting", commsEnabled],
                  ["Send announcement", commsEnabled],
                  ["Share document", commsEnabled],
                ].map(([label, enabled]) => (
                  <button
                    key={String(label)}
                    type="button"
                    disabled={!enabled}
                    className="cursor-not-allowed rounded-xl border border-[var(--cc-border)] bg-slate-50 px-3 py-2 text-sm font-medium text-slate-400"
                    title="Coming soon"
                  >
                    {String(label)}
                  </button>
                ))}
              </div>
              <Link
                href={`/admin/tasks?assignee=${row.id}`}
                className="inline-flex text-sm font-semibold text-[var(--cc-info)] hover:underline"
              >
                Assign a task →
              </Link>
            </section>
          </>
        )}
      </div>
    </AdminGate>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--cc-muted)]">
        {label}
      </span>
      <span className="text-right text-sm text-slate-800">{value || "—"}</span>
    </div>
  );
}
