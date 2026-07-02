"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
  service_fee_enabled: boolean;
  service_fee_pct: number;
  service_fee_fixed_cents: number;
  updated_at: string | null;
};

const VEHICLE_ORDER = ["standard", "xl", "premium"];

export default function AdminTaxiPricingPage() {
  const [allRows, setAllRows] = useState<TaxiPricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState("US");
  const [currencyFilter, setCurrencyFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const session = await resolveBrowserStaffSession();
    setCanEdit(canWriteTaxiPricing(session?.role ?? null));

    const res = await adminFetch("/api/admin/taxi-pricing");
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setAllRows([]);
      setLoading(false);
      return;
    }

    const items = (body.items ?? []) as TaxiPricingRow[];
    setAllRows(items);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const countryOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allRows) {
      if (!map.has(row.country_code)) {
        map.set(row.country_code, row.currency);
      }
    }
    return Array.from(map.entries())
      .map(([country_code, currency]) => ({ country_code, currency }))
      .sort((a, b) => a.country_code.localeCompare(b.country_code));
  }, [allRows]);

  const currencyOptions = useMemo(() => {
    const set = new Set(allRows.map((row) => row.currency));
    return Array.from(set).sort();
  }, [allRows]);

  const visibleRows = useMemo(() => {
    return allRows
      .filter((row) => {
        if (countryFilter && row.country_code !== countryFilter) return false;
        if (currencyFilter && row.currency !== currencyFilter) return false;
        return true;
      })
      .sort(
        (a, b) =>
          a.country_code.localeCompare(b.country_code) ||
          VEHICLE_ORDER.indexOf(a.vehicle_class) -
            VEHICLE_ORDER.indexOf(b.vehicle_class)
      );
  }, [allRows, countryFilter, currencyFilter]);

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
          service_fee_enabled: form.get("service_fee_enabled") === "on",
          service_fee_pct: Number(form.get("service_fee_pct")),
          service_fee_fixed_cents: Number(form.get("service_fee_fixed_cents")),
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
              Tarifs par pays et par classe — standard, XL et premium.
            </p>
          </header>

          <div className="flex flex-wrap gap-4 rounded-2xl border border-slate-200 bg-white p-4">
            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Pays</span>
              <select
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value);
                  setCurrencyFilter("");
                }}
                className="rounded-xl border border-slate-300 px-3 py-2"
              >
                {countryOptions.length === 0 ? (
                  <option value="US">US</option>
                ) : (
                  countryOptions.map((opt) => (
                    <option key={opt.country_code} value={opt.country_code}>
                      {opt.country_code} · {opt.currency}
                    </option>
                  ))
                )}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-slate-600">Devise</span>
              <select
                value={currencyFilter}
                onChange={(e) => setCurrencyFilter(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2"
              >
                <option value="">Toutes (pays sélectionné)</option>
                {currencyOptions.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Aucun tarif pour ce filtre.
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              {visibleRows.map((row) => (
                <form
                  key={row.id}
                  onSubmit={(e) => void saveRow(e, row)}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold capitalize text-slate-900">
                        {row.vehicle_class}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {row.country_code} · {row.currency}
                      </p>
                    </div>
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
                        <span className="text-slate-600">
                          {label} ({row.currency})
                        </span>
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

                  <div className="mt-4 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm">
                    <div className="font-semibold text-indigo-900">
                      Client Service Fee / Frais de service
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="service_fee_enabled"
                        defaultChecked={row.service_fee_enabled}
                        disabled={!canEdit}
                      />
                      Service fee enabled (OFF by default)
                    </label>
                    <label className="block">
                      <span className="text-slate-600">Service fee %</span>
                      <input
                        name="service_fee_pct"
                        type="number"
                        step="0.01"
                        defaultValue={row.service_fee_pct ?? 0}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block">
                      <span className="text-slate-600">Minimum fixed fee (cents)</span>
                      <input
                        name="service_fee_fixed_cents"
                        type="number"
                        step="1"
                        defaultValue={row.service_fee_fixed_cents ?? 0}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </div>

                  <p className="mt-3 text-xs text-slate-500">
                    {row.config_key}
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
