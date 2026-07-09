"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

type CountyDraft = {
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  maintenance_mode: boolean;
};

type ServiceToggleKey = Exclude<keyof CountyDraft, "platform_enabled" | "maintenance_mode">;

const SERVICE_TOGGLE_LABELS: Record<ServiceToggleKey, string> = {
  taxi_enabled: "Taxi",
  delivery_enabled: "Delivery",
  restaurant_enabled: "Food",
  marketplace_enabled: "Marketplace",
  seller_enabled: "Seller",
  checkout_enabled: "Paiement",
  payout_enabled: "Payout",
};

function countyKey(row: Pick<CountyRow, "country_code" | "region_code" | "county_code">) {
  return `${row.country_code}/${row.region_code}/${row.county_code}`;
}

function rowToDraft(row: CountyRow): CountyDraft {
  return {
    platform_enabled: Boolean(row.platform_enabled),
    taxi_enabled: Boolean(row.taxi_enabled),
    delivery_enabled: Boolean(row.delivery_enabled),
    restaurant_enabled: Boolean(row.restaurant_enabled),
    marketplace_enabled: Boolean(row.marketplace_enabled),
    seller_enabled: Boolean(row.seller_enabled),
    checkout_enabled: Boolean(row.checkout_enabled),
    payout_enabled: Boolean(row.payout_enabled),
    maintenance_mode: Boolean(row.maintenance_mode),
  };
}

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
  const [drafts, setDrafts] = useState<Record<string, CountyDraft>>({});
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [countryFilter, setCountryFilter] = useState("US");
  const [regionFilter, setRegionFilter] = useState("ny");

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
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

    if (!regionsRes.ok || regionsBody.ok === false) {
      setErrorMsg(regionsBody.error ?? `Regions load failed (${regionsRes.status})`);
    }
    if (!countiesRes.ok || countiesBody.ok === false) {
      setErrorMsg(countiesBody.error ?? `Counties load failed (${countiesRes.status})`);
    }

    const nextCounties = (countiesBody.items ?? []) as CountyRow[];
    setRegions(regionsBody.items ?? []);
    setCounties(nextCounties);
    setDrafts(
      Object.fromEntries(nextCounties.map((row) => [countyKey(row), rowToDraft(row)]))
    );
    setLoading(false);
  }, [countryFilter, regionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedRegion = useMemo(
    () => regions.find((r) => r.region_code === regionFilter) ?? null,
    [regions, regionFilter]
  );

  const stateOn = Boolean(selectedRegion?.platform_enabled);
  const stateOff = selectedRegion ? !selectedRegion.platform_enabled : false;
  const stateName = selectedRegion?.region_name ?? "New York";

  function updateDraft(key: string, patch: Partial<CountyDraft>) {
    setDrafts((prev) => {
      const current = prev[key];
      if (!current) return prev;
      const next = { ...current, ...patch };

      // County OFF → force all services OFF in the draft.
      if (patch.platform_enabled === false) {
        next.taxi_enabled = false;
        next.delivery_enabled = false;
        next.restaurant_enabled = false;
        next.marketplace_enabled = false;
        next.seller_enabled = false;
        next.checkout_enabled = false;
        next.payout_enabled = false;
      }

      return { ...prev, [key]: next };
    });
  }

  async function saveCounty(row: CountyRow) {
    if (!canEdit) return;
    if (!stateOn) {
      setErrorMsg(`State is OFF — enable ${stateName} first`);
      return;
    }

    const key = countyKey(row);
    const draft = drafts[key] ?? rowToDraft(row);
    setSavingKey(key);
    setErrorMsg(null);

    try {
      const payload: Record<string, boolean | string> = {
        platform_enabled: draft.platform_enabled,
        taxi_enabled: draft.platform_enabled ? draft.taxi_enabled : false,
        delivery_enabled: draft.platform_enabled ? draft.delivery_enabled : false,
        restaurant_enabled: draft.platform_enabled ? draft.restaurant_enabled : false,
        marketplace_enabled: draft.platform_enabled ? draft.marketplace_enabled : false,
        seller_enabled: draft.platform_enabled ? draft.seller_enabled : false,
        checkout_enabled: draft.platform_enabled ? draft.checkout_enabled : false,
        payout_enabled: draft.platform_enabled ? draft.payout_enabled : false,
        maintenance_mode: draft.maintenance_mode,
      };

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
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        const msg =
          typeof json.error === "string"
            ? json.error
            : `Save failed (${res.status})`;
        setErrorMsg(msg);
        alert(msg);
        return;
      }

      const updated = json.item as CountyRow | undefined;
      if (updated) {
        setCounties((prev) =>
          prev.map((c) => (countyKey(c) === key ? { ...c, ...updated } : c))
        );
        setDrafts((prev) => ({ ...prev, [key]: rowToDraft({ ...row, ...updated }) }));
      } else {
        await load();
      }
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
                Marketplace. Activez d&apos;abord le State, puis le County, puis les services.
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
                    {!r.platform_enabled ? " — OFF" : " — ON"}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end text-sm text-slate-500">
              {counties.length} county{counties.length === 1 ? "" : "s"}
            </div>
          </div>

          {errorMsg ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {errorMsg}
            </div>
          ) : null}

          {stateOff ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              State is OFF — enable <strong>{stateName}</strong> first in{" "}
              <a href="/admin/platform-launch" className="underline font-medium">
                Platform Launch
              </a>
              . Service switches stay disabled until the State is ON.
            </div>
          ) : null}

          {!canEdit ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              Lecture seule — permission <code>platform_launch.manage</code> requise pour
              modifier les counties.
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
                const key = countyKey(row);
                const draft = drafts[key] ?? rowToDraft(row);
                const countyOn = draft.platform_enabled;
                const servicesEnabled = canEdit && stateOn && countyOn;
                const taxiLabel =
                  row.county_code === "nyc" ? "Taxi / TLC" : SERVICE_TOGGLE_LABELS.taxi_enabled;
                const serviceTitle = !stateOn
                  ? `State is OFF — enable ${stateName} first`
                  : !countyOn
                    ? "Enable county first"
                    : undefined;

                return (
                  <div
                    key={key}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-semibold text-slate-900">{row.county_name}</h2>
                        <p className="text-xs text-slate-500">
                          {row.country_code}/{row.region_code.toUpperCase()}/{row.county_code}
                        </p>
                      </div>
                      {statusBadge({
                        platform_enabled: draft.platform_enabled,
                        launch_status: draft.platform_enabled
                          ? draft.maintenance_mode
                            ? "maintenance"
                            : "enabled"
                          : "disabled",
                        maintenance_mode: draft.maintenance_mode,
                      })}
                    </div>

                    <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
                      <label
                        className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${
                          !stateOn || !canEdit
                            ? "border-slate-100 bg-slate-50 text-slate-400"
                            : "border-slate-200 bg-white"
                        }`}
                        title={
                          !stateOn
                            ? `State is OFF — enable ${stateName} first`
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={draft.platform_enabled}
                          disabled={!canEdit || !stateOn}
                          onChange={(e) =>
                            updateDraft(key, { platform_enabled: e.target.checked })
                          }
                        />
                        County
                      </label>
                      <label
                        className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${
                          !canEdit
                            ? "border-slate-100 bg-slate-50 text-slate-400"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={draft.maintenance_mode}
                          disabled={!canEdit || !stateOn}
                          onChange={(e) =>
                            updateDraft(key, { maintenance_mode: e.target.checked })
                          }
                        />
                        Maintenance
                      </label>
                    </div>

                    {!countyOn && stateOn ? (
                      <p className="mb-2 text-xs text-slate-500">Enable county first</p>
                    ) : null}

                    <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p className="font-semibold text-slate-800">
                        County Status · {countyOn && stateOn ? "ON" : "OFF"}
                      </p>
                      <p className="mt-1">
                        {countyOn && stateOn
                          ? "County is active. Service availability follows the toggles below."
                          : "Services are unavailable for customers, drivers, restaurants and marketplace."}
                      </p>
                      {countyOn && stateOn ? (
                        <ul className="mt-2 space-y-1">
                          {!draft.taxi_enabled ? (
                            <li>
                              <strong>Taxi Disabled</strong> — Customers cannot request taxi
                              rides. Drivers cannot receive taxi trips.
                            </li>
                          ) : null}
                          {!draft.delivery_enabled ? (
                            <li>
                              <strong>Delivery Disabled</strong> — Parcel and courier requests
                              are unavailable.
                            </li>
                          ) : null}
                          {!draft.restaurant_enabled ? (
                            <li>
                              <strong>Food Disabled</strong> — Restaurants are hidden. Customers
                              cannot order food.
                            </li>
                          ) : null}
                          {!draft.marketplace_enabled ? (
                            <li>
                              <strong>Marketplace Disabled</strong> — Stores are hidden.
                              Customers cannot purchase products.
                            </li>
                          ) : null}
                        </ul>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {(Object.keys(SERVICE_TOGGLE_LABELS) as ServiceToggleKey[]).map(
                        (toggleKey) => (
                          <label
                            key={toggleKey}
                            title={serviceTitle}
                            className={`flex items-center gap-2 rounded-lg border px-2 py-2 ${
                              servicesEnabled
                                ? "border-slate-200 bg-white"
                                : "border-slate-100 bg-slate-50 text-slate-400"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(draft[toggleKey])}
                              disabled={!servicesEnabled}
                              onChange={(e) =>
                                updateDraft(key, { [toggleKey]: e.target.checked })
                              }
                            />
                            {toggleKey === "taxi_enabled"
                              ? taxiLabel
                              : SERVICE_TOGGLE_LABELS[toggleKey]}
                          </label>
                        )
                      )}
                    </div>

                    {canEdit ? (
                      <button
                        type="button"
                        disabled={savingKey === key || !stateOn}
                        title={
                          !stateOn
                            ? `State is OFF — enable ${stateName} first`
                            : undefined
                        }
                        onClick={() => void saveCounty(row)}
                        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {savingKey === key ? "Saving…" : "Save county"}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
