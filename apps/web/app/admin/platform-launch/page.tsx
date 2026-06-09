"use client";

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
  | "checkout_enabled"
  | "payout_enabled"
  | "maintenance_mode";

const TOGGLE_LABELS: Record<ToggleKey, string> = {
  platform_enabled: "Plateforme",
  taxi_enabled: "Taxi",
  delivery_enabled: "Delivery",
  restaurant_enabled: "Restaurant",
  checkout_enabled: "Paiement",
  payout_enabled: "Payout",
  maintenance_mode: "Maintenance",
};

function statusBadge(row: PlatformRow) {
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

export default function AdminPlatformLaunchPage() {
  const [rows, setRows] = useState<PlatformRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [continentFilter, setContinentFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManagePlatformLaunch(session?.role ?? null));
    const res = await adminFetch("/api/admin/platform-launch");
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, []);

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
      for (const key of Object.keys(TOGGLE_LABELS) as ToggleKey[]) {
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

  return (
    <AdminGate requiredPermission="platform_launch.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Platform Launch Control</h1>
              <p className="mt-1 text-sm text-slate-600">
                Activation globale par pays — plateforme, taxi, delivery, restaurant, paiement,
                payout. Complète taxi_countries sans le remplacer.
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href="/admin/taxi-launch"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Taxi Launch →
              </a>
              <a
                href="/admin/taxi-countries"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Taxi Countries →
              </a>
            </div>
          </header>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <label className="flex min-w-[220px] flex-1 flex-col text-sm">
              Recherche pays
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Code, nom, région…"
                className="mt-1 rounded-lg border px-3 py-2"
              />
            </label>
            <label className="flex min-w-[180px] flex-col text-sm">
              Continent
              <select
                value={continentFilter}
                onChange={(e) => setContinentFilter(e.target.value)}
                className="mt-1 rounded-lg border px-3 py-2"
              >
                <option value="all">Tous</option>
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
            <p className="text-sm text-slate-500">Chargement…</p>
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
                    {statusBadge(row)}
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                    {(Object.keys(TOGGLE_LABELS) as ToggleKey[]).map((key) => (
                      <label key={key} className="flex items-center gap-2 rounded-lg border border-slate-100 px-2 py-2">
                        <input
                          type="checkbox"
                          name={key}
                          defaultChecked={Boolean(row[key])}
                          disabled={!canEdit}
                        />
                        {TOGGLE_LABELS[key]}
                      </label>
                    ))}
                  </div>

                  {canEdit ? (
                    <button
                      type="submit"
                      disabled={savingCode === row.country_code}
                      className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingCode === row.country_code ? "Saving…" : "Save"}
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
