"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canWriteTaxiPricing } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import {
  formatTaxiMoney,
  type TaxiPricingPreviewBreakdown,
} from "@/lib/taxiPricingPreview";

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

const VEHICLE_ORDER = ["standard", "xl", "premium"] as const;

function MoneyInput(props: {
  label: string;
  name: string;
  value: number;
  currency: string;
  canEdit: boolean;
}) {
  return (
    <label className="block">
      <span className="text-slate-600">
        {props.label} ({props.currency})
      </span>
      <input
        name={props.name}
        type="number"
        step="0.01"
        defaultValue={props.value}
        disabled={!props.canEdit}
        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
      />
    </label>
  );
}

export default function AdminTaxiPricingPage() {
  const [allRows, setAllRows] = useState<TaxiPricingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState("US");
  const [currencyFilter, setCurrencyFilter] = useState("");

  const [previewClass, setPreviewClass] = useState<string>("standard");
  const [previewMiles, setPreviewMiles] = useState("5");
  const [previewMinutes, setPreviewMinutes] = useState("15");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaxiPricingPreviewBreakdown | null>(
    null
  );
  const [previewNote, setPreviewNote] = useState<string | null>(null);

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

    setAllRows((body.items ?? []) as TaxiPricingRow[]);
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
    return Array.from(new Set(allRows.map((row) => row.currency))).sort();
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
          VEHICLE_ORDER.indexOf(a.vehicle_class as (typeof VEHICLE_ORDER)[number]) -
            VEHICLE_ORDER.indexOf(b.vehicle_class as (typeof VEHICLE_ORDER)[number])
      );
  }, [allRows, countryFilter, currencyFilter]);

  async function onSave(e: FormEvent<HTMLFormElement>, row: TaxiPricingRow) {
    e.preventDefault();
    if (!canEdit) return;

    const form = new FormData(e.currentTarget);
    const driverShare = Number(form.get("driver_share_pct"));
    const platformShare = Number(form.get("platform_share_pct"));
    if (
      !Number.isFinite(driverShare) ||
      !Number.isFinite(platformShare) ||
      driverShare < 0 ||
      platformShare < 0 ||
      driverShare + platformShare > 100 + 1e-9
    ) {
      alert("Driver Share + MMD Platform Share must total ≤ 100%");
      return;
    }

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
          driver_share_pct: driverShare,
          platform_share_pct: platformShare,
          service_fee_enabled: form.get("service_fee_enabled") === "on",
          service_fee_pct: Number(form.get("service_fee_pct")),
          service_fee_fixed_cents: Number(form.get("service_fee_fixed_cents")),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        alert(json.error ?? "Échec enregistrement");
        return;
      }
      await load();
    } finally {
      setSavingId(null);
    }
  }

  async function onPreview() {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const res = await adminFetch("/api/admin/taxi-pricing/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country_code: countryFilter || "US",
          vehicle_class: previewClass,
          distance_miles: Number(previewMiles) || 0,
          duration_minutes: Number(previewMinutes) || 0,
          passenger_count: 1,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        setPreview(null);
        setPreviewNote(null);
        setPreviewError(body.error ?? "Preview failed");
        return;
      }
      setPreview(body.preview as TaxiPricingPreviewBreakdown);
      setPreviewNote(typeof body.note === "string" ? body.note : null);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_pricing.read">
      <main className="space-y-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Taxi Pricing</h1>
            <p className="mt-1 text-sm text-slate-600">
              Tarifs, répartition chauffeur / MMD et frais client — même moteur
              qu&apos;une vraie course (<code>quote_taxi_ride</code>).
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
                  setPreview(null);
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

          <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5">
            <h2 className="text-lg font-semibold text-emerald-950">
              Pricing Preview
            </h2>
            <p className="mt-1 text-xs text-emerald-900/80">
              Calcul via les moteurs live sur les tarifs <strong>sauvegardés</strong>.
              Enregistrez d&apos;abord vos changements pour les voir ici.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Classe</span>
                <select
                  value={previewClass}
                  onChange={(e) => setPreviewClass(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2"
                >
                  {VEHICLE_ORDER.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Miles</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={previewMiles}
                  onChange={(e) => setPreviewMiles(e.target.value)}
                  className="w-28 rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-slate-600">Minutes</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={previewMinutes}
                  onChange={(e) => setPreviewMinutes(e.target.value)}
                  className="w-28 rounded-xl border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={() => void onPreview()}
                  disabled={previewLoading}
                  className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                >
                  {previewLoading ? "Calcul…" : "Calculer"}
                </button>
              </div>
            </div>

            {previewError ? (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {previewError}
              </div>
            ) : null}

            {preview ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-xl bg-white p-4 text-sm shadow-sm">
                  <div className="font-semibold text-slate-900">Client</div>
                  <dl className="mt-2 space-y-1 text-slate-700">
                    <div className="flex justify-between gap-3">
                      <dt>Customer Fare</dt>
                      <dd className="font-medium">
                        {formatTaxiMoney(
                          preview.customer_fare_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Service Fee</dt>
                      <dd>
                        {formatTaxiMoney(
                          preview.service_fee_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Tax</dt>
                      <dd>
                        {formatTaxiMoney(preview.tax_cents, preview.currency)}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold">
                      <dt>Customer Total</dt>
                      <dd>
                        {formatTaxiMoney(
                          preview.customer_total_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="rounded-xl bg-white p-4 text-sm shadow-sm">
                  <div className="font-semibold text-slate-900">
                    Chauffeur &amp; MMD
                  </div>
                  <dl className="mt-2 space-y-1 text-slate-700">
                    <div className="flex justify-between gap-3">
                      <dt>Driver Earnings</dt>
                      <dd className="font-medium text-emerald-800">
                        {formatTaxiMoney(
                          preview.driver_earnings_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>MMD Platform Share</dt>
                      <dd>
                        {formatTaxiMoney(
                          preview.platform_share_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>MMD Platform Revenue</dt>
                      <dd className="font-medium">
                        {formatTaxiMoney(
                          preview.mmd_platform_revenue_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 text-amber-800">
                      <dt>Stripe Fee (est.)</dt>
                      <dd>
                        {formatTaxiMoney(
                          preview.stripe_fee_estimate_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3 border-t border-slate-200 pt-2 font-semibold">
                      <dt>MMD Net (est.)</dt>
                      <dd>
                        {formatTaxiMoney(
                          preview.mmd_net_estimate_cents,
                          preview.currency
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            ) : null}

            {previewNote ? (
              <p className="mt-3 text-[11px] leading-relaxed text-emerald-900/70">
                {previewNote}
              </p>
            ) : null}
          </section>

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
                  onSubmit={(e) => void onSave(e, row)}
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
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Tarif
                    </div>
                    <MoneyInput
                      label="Base fare"
                      name="base_fare"
                      value={row.base_fare}
                      currency={row.currency}
                      canEdit={canEdit}
                    />
                    <MoneyInput
                      label="Per mile"
                      name="per_mile"
                      value={row.per_mile}
                      currency={row.currency}
                      canEdit={canEdit}
                    />
                    <MoneyInput
                      label="Per minute"
                      name="per_minute"
                      value={row.per_minute}
                      currency={row.currency}
                      canEdit={canEdit}
                    />
                    <MoneyInput
                      label="Min fare"
                      name="min_fare"
                      value={row.min_fare}
                      currency={row.currency}
                      canEdit={canEdit}
                    />
                    <MoneyInput
                      label="Booking fee"
                      name="booking_fee"
                      value={row.booking_fee}
                      currency={row.currency}
                      canEdit={canEdit}
                    />
                  </div>

                  <div className="mt-4 space-y-3 rounded-xl border border-sky-100 bg-sky-50 p-3 text-sm">
                    <div className="font-semibold text-sky-950">
                      Répartition (subtotal course)
                    </div>
                    <label className="block">
                      <span className="text-slate-600">Driver Share (%)</span>
                      <input
                        name="driver_share_pct"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        defaultValue={row.driver_share_pct}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block">
                      <span className="text-slate-600">
                        MMD Platform Share (%)
                      </span>
                      <input
                        name="platform_share_pct"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        defaultValue={row.platform_share_pct}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <p className="text-[11px] text-sky-900/70">
                      Somme ≤ 100%. Appliqué au subtotal (hors tax &amp; service
                      fee) par <code>quote_taxi_ride</code>.
                    </p>
                  </div>

                  <div className="mt-4 space-y-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3 text-sm">
                    <div className="font-semibold text-indigo-900">
                      Frais client (Service Fee)
                    </div>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="service_fee_enabled"
                        defaultChecked={row.service_fee_enabled}
                        disabled={!canEdit}
                      />
                      Service fee enabled
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
                      <span className="text-slate-600">
                        Minimum fixed fee (cents)
                      </span>
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
                      {savingId === row.id
                        ? "Enregistrement…"
                        : "Enregistrer"}
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
