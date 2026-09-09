"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManagePlatformLaunch } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type PlatformRow = {
  id: string;
  country_code: string;
  country_name: string;
  continent: string | null;
  region: string | null;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  marketplace_checkout_live_enabled: boolean;
  marketplace_dispatch_live_enabled: boolean;
  marketplace_payouts_live_enabled: boolean;
  maintenance_mode: boolean;
  launch_status: "enabled" | "disabled" | "maintenance";
};

type RegionRow = {
  id: string;
  country_code: string;
  region_code: string;
  region_name: string;
  region_type: string;
  mmd_zone_id: string | null;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  marketplace_checkout_live_enabled: boolean;
  marketplace_dispatch_live_enabled: boolean;
  marketplace_payouts_live_enabled: boolean;
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

type LiveToggleKey =
  | "marketplace_checkout_live_enabled"
  | "marketplace_dispatch_live_enabled"
  | "marketplace_payouts_live_enabled";

function getToggleLabels(t: (source: string) => string) {
  const toggleLabels: Record<ToggleKey, string> = {
    platform_enabled: t("Plateforme"),
    taxi_enabled: t("Taxi"),
    delivery_enabled: t("Delivery"),
    restaurant_enabled: t("Restaurant"),
    marketplace_enabled: t("Marketplace"),
    seller_enabled: t("Seller"),
    checkout_enabled: t("Paiement"),
    payout_enabled: t("Payout"),
    maintenance_mode: t("Maintenance"),
  };
  const liveToggleLabels: Record<LiveToggleKey, string> = {
    marketplace_checkout_live_enabled: t("Checkout live (certifié)"),
    marketplace_dispatch_live_enabled: t("Dispatch live (certifié)"),
    marketplace_payouts_live_enabled: t("Payouts live (certifié)"),
  };
  return { toggleLabels, liveToggleLabels };
}

function statusBadge(row: PlatformRow, t: (english: string) => string) {
  if (row.maintenance_mode || row.launch_status === "maintenance") {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
        {t("Maintenance")}
      </span>
    );
  }
  if (row.platform_enabled && row.launch_status === "enabled") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
        {t("Live")}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
      {t("Off")}
    </span>
  );
}

export default function AdminPlatformLaunchPage() {
  const { t } = useAdminT();
  const { toggleLabels, liveToggleLabels } = getToggleLabels(t);

  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [regionRows, setRegionRows] = useState<RegionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [savingRegionKey, setSavingRegionKey] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [continentFilter, setContinentFilter] = useState("all");
  const [regionCountryFilter, setRegionCountryFilter] = useState("US");

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManagePlatformLaunch(session?.role ?? null));
    const [countriesRes, regionsRes] = await Promise.all([
      adminFetch("/api/admin/platform-launch"),
      adminFetch(`/api/admin/platform-launch/regions?country=${regionCountryFilter}`),
    ]);
    const countriesBody = await countriesRes.json().catch(() => ({}));
    const regionsBody = await regionsRes.json().catch(() => ({}));
    setRows(countriesBody.items ?? []);
    setRegionRows(regionsBody.items ?? []);
    setLoading(false);
  }, [regionCountryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const continents = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.continent) set.add(row.continent);
    }
    return Array.from(set).sort();
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (continentFilter !== "all" && row.continent !== continentFilter) return false;
      if (!q) return true;
      return (
        row.country_code.toLowerCase().includes(q) ||
        row.country_name.toLowerCase().includes(q) ||
        String(row.region ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, continentFilter]);

  async function saveRow(e: FormEvent<HTMLFormElement>, row: PlatformRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    setSavingCode(row.country_code);
    try {
      const payload: Record<string, boolean | string> = {};
      for (const key of Object.keys(toggleLabels) as ToggleKey[]) {
        payload[key] = form.get(key) === "on";
      }
      for (const key of Object.keys(liveToggleLabels) as LiveToggleKey[]) {
        payload[key] = form.get(key) === "on";
      }

      if (payload.maintenance_mode) {
        payload.launch_status = "maintenance";
      } else if (payload.platform_enabled) {
        payload.launch_status = "enabled";
      } else {
        payload.launch_status = "disabled";
      }

      const res = await adminFetch(`/api/admin/platform-launch/${row.country_code}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) alert(json.error ?? "Échec");
      else await load();
    } finally {
      setSavingCode(null);
    }
  }

  async function saveRegionRow(e: FormEvent<HTMLFormElement>, row: RegionRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    const key = `${row.country_code}/${row.region_code}`;
    setSavingRegionKey(key);
    try {
      const payload: Record<string, boolean | string> = {};
      for (const toggleKey of Object.keys(toggleLabels) as ToggleKey[]) {
        payload[toggleKey] = form.get(toggleKey) === "on";
      }
      for (const liveKey of Object.keys(liveToggleLabels) as LiveToggleKey[]) {
        payload[liveKey] = form.get(liveKey) === "on";
      }

      if (payload.maintenance_mode) {
        payload.launch_status = "maintenance";
      } else if (payload.platform_enabled) {
        payload.launch_status = "enabled";
      } else {
        payload.launch_status = "disabled";
      }

      const res = await adminFetch(
        `/api/admin/platform-launch/regions/${row.country_code}/${row.region_code}`,
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
      setSavingRegionKey(null);
    }
  }

  return (
    <AdminGate requiredPermission="platform_launch.read">
      <main className="space-y-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("Platform Launch Control")}</h1>
              <p className="mt-1 text-sm text-slate-600">
                Activation globale par pays et overrides région/state/zone GN — plateforme,
                services, marketplace/seller flags. Les flags live Marketplace restent OFF par
                défaut et exigent aussi la certification env serveur.
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href="/admin/county-management"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                {t("County Management →")}
              </a>
              <a
                href="/admin/taxi-launch"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                {t("Taxi Launch →")}
              </a>
              <a
                href="/admin/taxi-countries"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                {t("Taxi Countries →")}
              </a>
            </div>
          </header>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="flex min-w-[220px] flex-1 flex-col text-sm">
              {t("Recherche pays")}
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("Code, nom, région…")}
                className="mt-1 rounded-lg border px-3 py-2"
              />
            </label>
            <label className="flex min-w-[180px] flex-col text-sm">
              {t("Continent")}
              <select
                value={continentFilter}
                onChange={(e) => setContinentFilter(e.target.value)}
                className="mt-1 rounded-lg border px-3 py-2"
              >
                <option value="all">{t("Tous")}</option>
                {continents.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end text-sm text-slate-500">
              {filteredRows.length} / {rows.length} pays
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-slate-500">{t("Chargement…")}</p>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {filteredRows.map((row) => (
                <form
                  key={row.country_code}
                  onSubmit={(e) => void saveRow(e, row)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="font-semibold text-slate-900">
                        {row.country_code} · {row.country_name}
                      </h2>
                      <p className="text-xs text-slate-500">
                        {[row.continent, row.region].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                    {statusBadge(row, t)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    {(Object.keys(toggleLabels) as ToggleKey[]).map((key) => (
                      <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-2">
                        <input
                          type="checkbox"
                          name={key}
                          defaultChecked={Boolean(row[key])}
                          disabled={!canEdit}
                        />
                        {toggleLabels[key]}
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
                      {t("Marketplace live (certification requise)")}
                    </p>
                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                      {(Object.keys(liveToggleLabels) as LiveToggleKey[]).map((key) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 rounded-lg border border-amber-100 bg-white px-2 py-2"
                        >
                          <input
                            type="checkbox"
                            name={key}
                            defaultChecked={Boolean(row[key])}
                            disabled={!canEdit}
                          />
                          {liveToggleLabels[key]}
                        </label>
                      ))}
                    </div>
                  </div>

                  {canEdit ? (
                    <button
                      type="submit"
                      disabled={savingCode === row.country_code}
                      className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingCode === row.country_code ? t("Saving…") : t("Save")}
                    </button>
                  ) : null}
                </form>
              ))}
            </div>
          )}

          <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{t("Régions / States")}</h2>
                <p className="text-sm text-slate-600">
                  {t("Overrides commerciaux sparse (US states, zones GN). OFF par défaut.")}
                </p>
              </div>
              <label className="flex min-w-[140px] flex-col text-sm">
                {t("Pays régions")}
                <select
                  value={regionCountryFilter}
                  onChange={(e) => setRegionCountryFilter(e.target.value)}
                  className="mt-1 rounded-lg border px-3 py-2"
                >
                  <option value="US">{t("US")}</option>
                  <option value="GN">{t("GN")}</option>
                </select>
              </label>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              {regionRows.map((row) => (
                <form
                  key={`${row.country_code}-${row.region_code}`}
                  onSubmit={(e) => void saveRegionRow(e, row)}
                  className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-slate-900">
                        {row.country_code}/{row.region_code.toUpperCase()} · {row.region_name}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {row.region_type}
                        {row.mmd_zone_id ? " · mmd_zone linked" : ""}
                      </p>
                    </div>
                    {statusBadge(row as unknown as PlatformRow, t)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    {(Object.keys(toggleLabels) as ToggleKey[]).map((key) => (
                      <label
                        key={key}
                        className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-2 py-2"
                      >
                        <input
                          type="checkbox"
                          name={key}
                          defaultChecked={Boolean(row[key])}
                          disabled={!canEdit}
                        />
                        {toggleLabels[key]}
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
                      {t("Marketplace live (certification requise)")}
                    </p>
                    <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                      {(Object.keys(liveToggleLabels) as LiveToggleKey[]).map((key) => (
                        <label
                          key={key}
                          className="flex items-center gap-2 rounded-lg border border-amber-100 bg-white px-2 py-2"
                        >
                          <input
                            type="checkbox"
                            name={key}
                            defaultChecked={Boolean(row[key])}
                            disabled={!canEdit}
                          />
                          {liveToggleLabels[key]}
                        </label>
                      ))}
                    </div>
                  </div>

                  {canEdit ? (
                    <button
                      type="submit"
                      disabled={savingRegionKey === `${row.country_code}/${row.region_code}`}
                      className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingRegionKey === `${row.country_code}/${row.region_code}`
                        ? "Saving…"
                        : "Save region"}
                    </button>
                  ) : null}
                </form>
              ))}
            </div>
          </section>
        </div>
      </main>
    </AdminGate>
  );
}
