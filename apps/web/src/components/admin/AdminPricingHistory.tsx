"use client";

import { useCallback, useEffect, useState } from "react";

type HistoryRow = {
  id: string;
  pricing_config_id: string;
  changed_by: string | null;
  change_type: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  created_at: string;
};

export default function AdminPricingHistory({
  configId,
  canRollback,
}: {
  configId?: string;
  canRollback: boolean;
}) {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [rolling, setRolling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const url = new URL("/api/admin/pricing/history", window.location.origin);
    if (configId) url.searchParams.set("configId", configId);
    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    setRows(res.ok && body.ok ? body.items ?? [] : []);
    setLoading(false);
  }, [configId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function rollback(historyId: string) {
    if (!confirm("Restaurer cette version du pricing ?")) return;
    setRolling(historyId);
    const res = await fetch("/api/admin/pricing/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ historyId }),
    });
    const body = await res.json().catch(() => ({}));
    setRolling(null);
    if (!res.ok || !body.ok) {
      alert(body.error ?? "Rollback échoué");
      return;
    }
    window.location.reload();
  }

  if (loading) return <div className="text-sm text-slate-500">Historique…</div>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="min-w-full text-left text-xs">
        <thead className="border-b bg-slate-50 uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Config</th>
            <th className="px-3 py-2">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-slate-500">
                Aucun historique.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-100">
                <td className="px-3 py-2">{new Date(row.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">{row.change_type ?? "update"}</td>
                <td className="px-3 py-2 font-mono">
                  {row.pricing_config_id.slice(0, 8)}…
                </td>
                <td className="px-3 py-2">
                  {canRollback ? (
                    <button
                      type="button"
                      disabled={rolling === row.id}
                      onClick={() => void rollback(row.id)}
                      className="text-blue-600 underline disabled:opacity-50"
                    >
                      Rollback
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
