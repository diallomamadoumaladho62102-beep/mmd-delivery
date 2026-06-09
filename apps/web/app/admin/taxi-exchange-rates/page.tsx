"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiExchangeRates } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type RateRow = {
  id: string;
  from_currency: string;
  to_currency: string;
  rate: number;
  source: string;
  active: boolean;
  updated_at: string | null;
};

export default function AdminTaxiExchangeRatesPage() {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiExchangeRates(session?.role ?? null));
    const res = await adminFetch("/api/admin/taxi-exchange-rates");
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(e: FormEvent<HTMLFormElement>, row: RateRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    const res = await adminFetch("/api/admin/taxi-exchange-rates", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: row.id,
        active: form.get("active") === "on",
        rate: Number(form.get("rate")),
        source: String(form.get("source") ?? row.source),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) alert(json.error ?? "Échec");
    else await load();
  }

  return (
    <AdminGate requiredPermission="taxi_exchange_rates.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold">Taxi Exchange Rates</h1>
            <p className="text-sm text-slate-600">
              Taux de référence pour analytics/display — pas de conversion Stripe checkout.
            </p>
          </header>
          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-white">
              <table className="min-w-full text-sm">
                <thead className="border-b bg-slate-50 text-left">
                  <tr>
                    <th className="p-3">From</th>
                    <th className="p-3">To</th>
                    <th className="p-3">Rate</th>
                    <th className="p-3">Source</th>
                    <th className="p-3">Actif</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b">
                      <td className="p-3">{row.from_currency}</td>
                      <td className="p-3">{row.to_currency}</td>
                      <td className="p-3" colSpan={4}>
                        <form
                          className="flex flex-wrap items-center gap-2"
                          onSubmit={(e) => void saveRow(e, row)}
                        >
                          <input
                            name="rate"
                            type="number"
                            step="0.00000001"
                            defaultValue={row.rate}
                            disabled={!canEdit}
                            className="w-40 rounded border px-2 py-1"
                          />
                          <input
                            name="source"
                            defaultValue={row.source}
                            disabled={!canEdit}
                            className="w-32 rounded border px-2 py-1"
                          />
                          <label>
                            <input
                              type="checkbox"
                              name="active"
                              defaultChecked={row.active}
                              disabled={!canEdit}
                            />
                          </label>
                          {canEdit ? (
                            <button type="submit" className="rounded bg-slate-900 px-3 py-1 text-white">
                              Save
                            </button>
                          ) : null}
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
