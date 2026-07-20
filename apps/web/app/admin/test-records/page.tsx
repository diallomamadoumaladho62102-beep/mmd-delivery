"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";

type TestRecordRow = {
  entity_kind: string;
  id: string;
  status: string | null;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  driver_id: string | null;
  total: number | null;
  created_at: string | null;
  archived_at: string | null;
  is_test: boolean | null;
  hidden_from_user?: boolean | null;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fr-FR");
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function boolLabel(value: boolean | null | undefined): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "—";
}

function TestRecordsInner() {
  const [items, setItems] = useState<TestRecordRow[]>([]);
  const [count, setCount] = useState(0);
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminFetch("/api/admin/test-records");
    setLoading(false);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || body.ok === false) {
      setError(String(body.error ?? "Chargement impossible"));
      return;
    }
    setItems((body.items as TestRecordRow[]) ?? []);
    setCount(Number(body.count ?? 0));
    setSource(String(body.source ?? ""));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Archived / Test Data</h1>
        <p className="mt-1 text-sm text-slate-600">
          Trips flagged as test, soft-archived, or hidden from users. These records are
          excluded from production stats, dashboards, and normal admin lists.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            {loading ? "Chargement…" : `${count} record(s)`}
            {source ? ` · source: ${source}` : null}
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Actualiser
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <th className="px-2 py-2">Kind</th>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Payment</th>
                <th className="px-2 py-2">Stripe PI</th>
                <th className="px-2 py-2">Stripe Session</th>
                <th className="px-2 py-2">Driver</th>
                <th className="px-2 py-2">Total</th>
                <th className="px-2 py-2">Created</th>
                <th className="px-2 py-2">Archived</th>
                <th className="px-2 py-2">Test</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !loading ? (
                <tr>
                  <td colSpan={11} className="px-2 py-6 text-center text-slate-500">
                    Aucun enregistrement archivé ou test.
                  </td>
                </tr>
              ) : (
                items.map((row) => (
                  <tr key={`${row.entity_kind}:${row.id}`} className="border-b border-slate-100">
                    <td className="px-2 py-2 font-medium text-slate-800">{row.entity_kind}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-700">{row.id}</td>
                    <td className="px-2 py-2">{row.status ?? "—"}</td>
                    <td className="px-2 py-2">{row.payment_status ?? "—"}</td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-600">
                      {row.stripe_payment_intent_id ?? "—"}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-600">
                      {row.stripe_session_id ?? "—"}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs text-slate-600">
                      {row.driver_id ?? "—"}
                    </td>
                    <td className="px-2 py-2">{formatMoney(row.total)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(row.created_at)}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{formatDate(row.archived_at)}</td>
                    <td className="px-2 py-2">{boolLabel(row.is_test)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AdminTestRecordsPage() {
  return (
    <AdminGate requiredPermission="test_records.read">
      <TestRecordsInner />
    </AdminGate>
  );
}
