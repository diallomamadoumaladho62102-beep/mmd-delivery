"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManagePlatformLaunch } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type RegionRow = {
  id: string;
  country_code: string;
  region_code: string;
  region_name: string;
  region_type: string;
  platform_enabled: boolean;
  launch_status: "enabled" | "disabled" | "maintenance";
  maintenance_mode: boolean;
};

type CountyRow = {
  id: string;
  country_code: string;
  region_code: string;
  county_code: string;
  county_name: string;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  maintenance_mode: boolean;
  launch_status: "enabled" | "disabled" | "maintenance";
};

type ToggleKey =
  | "platform_enabled"
  | "taxi_enabled"
  | "delivery_enabled"
  | "restaurant_enabled"
  | "marketplace_enabled"
  | "seller_enabled"
  | "checkout_enabled"
  | "payout_enabled"
  | "maintenance_mode";

const TOGGLE_LABELS: Record<ToggleKey, string> = {
  platform_enabled: "County",
  taxi_enabled: "Taxi",
  delivery_enabled: "Delivery",
  restaurant_enabled: "Food",
  marketplace_enabled: "Marketplace",
  seller_enabled: "Seller",
  checkout_enabled: "Paiement",
  payout_enabled: "Payout",
  maintenance_mode: "Maintenance",
};

function statusBadge(row: Pick<CountyRow, "platform_enabled" | "launch_status" | "maintenance_mode">) {
  if (row.maintenance_mode || row.launch_status === "maintenance") {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
        Maintenance
      </span>
    );
  }
  if (row.platform_enabled && row.launch_status === "enabled") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        Live
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
      Off
    </span>
  );
}

export default function AdminCountyManagementPage() {
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [counties, setCounties] = useState<CountyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState("US");
  const [regionFilter, setRegionFilter] = useState("ny");

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManagePlatformLaunch(session?.role ?? null));

    const [regionsRes, countiesRes] = await Promise.all([
      adminFetch(`/api/admin/platform-launch/regions?country=${countryFilter}`),
      adminFetch(
        `/api/admin/platform-launch/counties?country=${countryFilter}&region=${regionFilter}`
      ),
    ]);
    const regionsBody = await regionsRes.json().catch(() => ({}));
    const countiesBody = await countiesRes.json().catch(() => ({}));
    setRegions(regionsBody.items ?? []);
    setCounties(countiesBody.items ?? []);
    setLoading(false);
  }, [countryFilter, regionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.region_code === regionFilter) ?? null,
    [regions, regionFilter]
  );

  const stateOff = selectedRegion ? !selectedRegion.platform_enabled : false;

  async function saveCounty(e: FormEvent<HTMLFormElement>, row: CountyRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    const key = `${row.country_code}/${row.region_code}/${row.county_code}`;
    setSavingKey(key);
    try {
      const payload: Record<string, boolean | string> = {};
      for (const toggleKey of Object.keys(TOGGLE_LABELS) as ToggleKey[]) {
        payload[toggleKey] = form.get(toggleKey) === "on";
      }

      if (payload.maintenance_mode) {
        payload.launch_status = "maintenance";
      } else if (payload.platform_enabled) {
        payload.launch_status = "enabled";
      } else {
        payload.launch_status = "disabled";
      }

      const res = await adminFetch(
        `/api/admin/platform-launch/counties/${row.country_code}/${row.region_code}/${row.county_code}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!res.ok || !json.ok) alert(json.error ?? "Échec");
      else await load();
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <AdminGate requiredPermission="platform_launch.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">County Management</h1>
              <p className="mt-1 text-sm text-slate-600">
                Activation par county sous chaque State existant — Taxi, Delivery, Food,
                Marketplace. Si le State est OFF, tous les counties restent inactifs côté
                clients/drivers/restaurants.
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href="/admin/platform-launch"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                ← Platform Launch
              </a>
            </div>
          </header>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="flex min-w-[120px] flex-col text-sm">
              Pays
              <select
                value={countryFilter}
                onChange={(e) => {
                  setCountryFilter(e.target.value);
                  setRegionFilter(e.target.value === "US" ? "ny" : "");
                }}
                className="mt-1 rounded-lg border px-3 py-2"
              >
                <option value="US">US</option>
              </select>
            </label>
            <label className="flex min-w-[200px] flex-1 flex-col text-sm">
              State / Région
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="mt-1 rounded-lg border px-3 py-2"
              >
                {regions.map((r) => (
                  <option key={r.region_code} value={r.region_code}>
                    {r.region_name} ({r.region_code.toUpperCase()})
                    {!r.platform_enabled ? " — OFF" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end text-sm text-slate-500">
              {counties.length} county{counties.length === 1 ? "" : "s"}
            </div>
          </div>

          {stateOff ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Le State <strong>{selectedRegion?.region_name ?? regionFilter}</strong> est OFF.
              Les switches county ci-dessous n&apos;auront aucun effet tant que le State
              n&apos;est pas activé dans Platform Launch.
            </div>
          ) : null}

          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : counties.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
              Aucun county configuré pour {countryFilter}/{regionFilter.toUpperCase()}. Les
              seeds NY (Nassau, Suffolk, NYC, Westchester) sont créés par migration.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {counties.map((row) => {
                const key = `${row.country_code}/${row.region_code}/${row.county_code}`;
                const taxiLabel =
                  row.county_code === "nyc" ? "Taxi / TLC" : TOGGLE_LABELS.taxi_enabled;
                return (
                  <form
                    key={key}
                    onSubmit={(e) => void saveCounty(e, row)}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold text-slate-900">{row.county_name}</h2>
                        <p className="text-xs text-slate-500">
                          {row.country_code}/{row.region_code.toUpperCase()}/{row.county_code}
                        </p>
                      </div>
                      {statusBadge(row)}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {(Object.keys(TOGGLE_LABELS) as ToggleKey[]).map((toggleKey) => (
                        <label
                          key={toggleKey}
                          className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-2"
                        >
                          <input
                            type="checkbox"
                            name={toggleKey}
                            defaultChecked={Boolean(row[toggleKey])}
                            disabled={!canEdit}
                          />
                          {toggleKey === "taxi_enabled" ? taxiLabel : TOGGLE_LABELS[toggleKey]}
                        </label>
                      ))}
                    </div>

                    {canEdit ? (
                      <button
                        type="submit"
                        disabled={savingKey === key}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {savingKey === key ? "Saving…" : "Save county"}
                      </button>
                    ) : null}
                  </form>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
