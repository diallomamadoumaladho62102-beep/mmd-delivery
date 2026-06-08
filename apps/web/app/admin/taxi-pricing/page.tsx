"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canWriteTaxiPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type TaxiPricingRow = {
  id: string;
  config_key: string;
  vehicle_class: string;
  country_code: string;
  currency: string;
  active: boolean;
  base_fare: number;
  per_mile: number;
  per_minute: number;
  min_fare: number;
  booking_fee: number;
  driver_share_pct: number;
  platform_share_pct: number;
  updated_at: string | null;
};

export default function AdminTaxiPricingPage() {
  const [rows, setRows] = useState<TaxiPricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const session = await resolveBrowserStaffSession();
    setCanEdit(canWriteTaxiPricing(session?.role ?? null));

    const res = await adminFetch("/api/admin/taxi-pricing");
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(e: FormEvent<HTMLFormElement>, row: TaxiPricingRow) {
    e.preventDefault();
    if (!canEdit) return;

    const form = new FormData(e.currentTarget);
    setSavingId(row.id);

    try {
      const res = await adminFetch("/api/admin/taxi-pricing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: row.id,
          active: form.get("active") === "on",
          base_fare: Number(form.get("base_fare")),
          per_mile: Number(form.get("per_mile")),
          per_minute: Number(form.get("per_minute")),
          min_fare: Number(form.get("min_fare")),
          booking_fee: Number(form.get("booking_fee")),
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        alert(json.error ?? "Échec enregistrement");
        return;
      }

      await load();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_pricing.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Taxi Pricing</h1>
            <p className="mt-1 text-sm text-slate-600">
              Tarifs standard, XL et premium — audit admin à chaque modification.
            </p>
          </header>

          {loading ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              {rows.map((row) => (
                <form
                  key={row.id}
                  onSubmit={(e) => void saveRow(e, row)}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold capitalize text-slate-900">
                      {row.vehicle_class}
                    </h2>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={row.active}
                        disabled={!canEdit}
                      />
                      Actif
                    </label>
                  </div>

                  <div className="space-y-3 text-sm">
                    {(
                      [
                        ["base_fare", "Base fare"],
                        ["per_mile", "Per mile"],
                        ["per_minute", "Per minute"],
                        ["min_fare", "Min fare"],
                        ["booking_fee", "Booking fee"],
                      ] as const
                    ).map(([field, label]) => (
                      <label key={field} className="block">
                        <span className="text-slate-600">{label}</span>
                        <input
                          name={field}
                          type="number"
                          step="0.01"
                          defaultValue={row[field]}
                          disabled={!canEdit}
                          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                        />
                      </label>
                    ))}
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    {row.currency} · {row.country_code}
                    {row.updated_at
                      ? ` · MAJ ${new Date(row.updated_at).toLocaleString()}`
                      : ""}
                  </p>

                  {canEdit ? (
                    <button
                      type="submit"
                      disabled={savingId === row.id}
                      className="mt-4 w-full rounded-xl bg-slate-900 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingId === row.id ? "Enregistrement…" : "Enregistrer"}
                    </button>
                  ) : null}
                </form>
              ))}
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
