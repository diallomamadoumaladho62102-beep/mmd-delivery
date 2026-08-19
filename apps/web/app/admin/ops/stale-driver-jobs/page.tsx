"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";

type StaleItem = {
  id: string;
  service: string;
  status: string;
  driver_id: string | null;
  payment_status?: string | null;
  driver_delivery_payout?: number | string | null;
  restaurant_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  age_hours?: number | null;
  suggested_action?: string;
  source_table: "orders" | "delivery_requests";
};

export default function AdminStaleDriverJobsPage() {
  const [items, setItems] = useState<StaleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ops/stale-driver-jobs", {
        credentials: "include",
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: StaleItem[];
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setItems(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function cancelAbandoned(row: StaleItem) {
    if (busyId) return;
    const ok = window.confirm(
      `Cancel abandoned ${row.service} job ${row.id}?\n\nThis uses official Admin cancel/refund (audited). Refuses if pickup/delivery evidence exists.`,
    );
    if (!ok) return;
    setBusyId(row.id);
    setActionMsg(null);
    try {
      const res = await adminFetch("/api/admin/ops/resolve-stale-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          source_table: row.source_table,
          action: "cancel",
          reason: "admin_stale_job_abandoned_cancel",
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setActionMsg(json.message || "Canceled");
      await load();
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AdminGate requiredPermission="orders.read">
      <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-slate-900">
            Stale assigned jobs
          </h1>
          <p className="text-sm text-slate-600">
            Abandoned Food/Delivery jobs older than 48h. Detect → Admin action →
            audit → final status. Mid-mission jobs are never auto-hidden from
            recovery.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white"
          >
            Refresh
          </button>
          {actionMsg ? (
            <p className="text-sm text-slate-700">{actionMsg}</p>
          ) : null}
        </header>

        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : null}
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <p className="text-sm text-slate-500">No stale assigned jobs found.</p>
        ) : null}

        <ul className="space-y-3">
          {items.map((row) => {
            const href =
              row.source_table === "delivery_requests"
                ? `/admin/delivery-requests?highlight=${encodeURIComponent(row.id)}`
                : `/admin/orders/${row.id}`;
            return (
              <li
                key={`${row.source_table}:${row.id}`}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      {row.service} · {row.status}
                      {row.restaurant_name
                        ? ` · ${row.restaurant_name}`
                        : ""}
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      {row.id}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Link
                      href={href}
                      className="text-sm font-medium text-blue-700 underline"
                    >
                      Open detail
                    </Link>
                    <button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void cancelAbandoned(row)}
                      className="text-sm font-medium text-red-700 underline disabled:opacity-50"
                    >
                      {busyId === row.id ? "Canceling…" : "Cancel abandoned"}
                    </button>
                  </div>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  <div>
                    <dt className="text-slate-400">Driver</dt>
                    <dd className="font-mono">{row.driver_id ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Age (h)</dt>
                    <dd>
                      {row.age_hours != null
                        ? Math.round(row.age_hours)
                        : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Payment</dt>
                    <dd>{row.payment_status ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Suggested</dt>
                    <dd>{row.suggested_action ?? "review"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Updated</dt>
                    <dd>{row.updated_at ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-400">Payout</dt>
                    <dd>{String(row.driver_delivery_payout ?? "—")}</dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      </main>
    </AdminGate>
  );
}
