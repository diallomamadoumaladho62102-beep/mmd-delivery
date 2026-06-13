"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageMmdAi } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type CountryRow = {
  country_code: string;
  country_name: string;
  continent: string | null;
  ai_enabled: boolean;
  ai_enabled_updated_at: string | null;
  updated_by_name: string | null;
  scope_type: "country";
};

type RegionRow = {
  country_code: string;
  region_code: string;
  region_name: string;
  region_type: string;
  state_code: string | null;
  ai_enabled: boolean;
  ai_enabled_updated_at: string | null;
  updated_by_name: string | null;
  scope_type: "region";
};

function AiBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
      ON
    </span>
  ) : (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
      OFF
    </span>
  );
}

export default function AdminMmdAiLaunchPage() {
  const [countries, setCountries] = useState<CountryRow[]>([]);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [regionCountryFilter, setRegionCountryFilter] = useState("US");
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageMmdAi(session?.role ?? null));

    const res = await adminFetch(
      `/api/admin/mmd-ai/launch${regionCountryFilter ? `?country=${regionCountryFilter}` : ""}`
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Unable to load launch control");
      setLoading(false);
      return;
    }
    setCountries(body.countries ?? []);
    setRegions(body.regions ?? []);
    setLoading(false);
  }, [regionCountryFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredCountries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (row) =>
        row.country_code.toLowerCase().includes(q) ||
        row.country_name.toLowerCase().includes(q)
    );
  }, [countries, search]);

  async function patchCountry(row: CountryRow, ai_enabled: boolean) {
    setSavingKey(`country:${row.country_code}`);
    const res = await adminFetch(`/api/admin/mmd-ai/launch/${row.country_code}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ai_enabled }),
    });
    const body = await res.json().catch(() => ({}));
    setSavingKey(null);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Update failed");
      return;
    }
    await load();
  }

  async function patchRegion(row: RegionRow, ai_enabled: boolean) {
    setSavingKey(`region:${row.country_code}/${row.region_code}`);
    const res = await adminFetch(
      `/api/admin/mmd-ai/launch/regions/${row.country_code}/${row.region_code}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_enabled }),
      }
    );
    const body = await res.json().catch(() => ({}));
    setSavingKey(null);
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Update failed");
      return;
    }
    await load();
  }

  return (
    <AdminGate requiredPermission="mmd_ai.read">
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-6xl space-y-6 p-6">
          <header className="space-y-3">
            <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
              MMD Delivery · MMD AI Launch Control
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                  MMD AI Launch Control
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-slate-600">
                  Enable or disable MMD AI by country, state, or region without redeploying.
                  Global flag `AI_ASSISTANT_ENABLED` must still be ON for live traffic.
                </p>
              </div>
              <Link
                href="/admin/mmd-ai"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                MMD AI Dashboard
              </Link>
            </div>
          </header>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">Countries</h2>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search country…"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-4">Country</th>
                      <th className="py-2 pr-4">State</th>
                      <th className="py-2 pr-4">Region</th>
                      <th className="py-2 pr-4">AI Enabled</th>
                      <th className="py-2 pr-4">Last Updated</th>
                      <th className="py-2 pr-4">Updated By</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCountries.map((row) => (
                      <tr key={row.country_code} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-medium text-slate-900">
                          {row.country_name}{" "}
                          <span className="text-slate-400">({row.country_code})</span>
                        </td>
                        <td className="py-3 pr-4 text-slate-500">—</td>
                        <td className="py-3 pr-4 text-slate-500">Country-wide</td>
                        <td className="py-3 pr-4">
                          <AiBadge enabled={row.ai_enabled} />
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {row.ai_enabled_updated_at
                            ? new Date(row.ai_enabled_updated_at).toLocaleString()
                            : "—"}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {row.updated_by_name ?? "—"}
                        </td>
                        <td className="py-3">
                          {canEdit ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={savingKey != null || row.ai_enabled}
                                onClick={() => void patchCountry(row, true)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                              >
                                Enable
                              </button>
                              <button
                                type="button"
                                disabled={savingKey != null || !row.ai_enabled}
                                onClick={() => void patchCountry(row, false)}
                                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                              >
                                Disable
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">Read-only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">Regions / States</h2>
              <select
                value={regionCountryFilter}
                onChange={(e) => setRegionCountryFilter(e.target.value)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                {["US", "GN", "SN", "CI", "ML"].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            {loading ? (
              <p className="text-sm text-slate-500">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-4">Country</th>
                      <th className="py-2 pr-4">State</th>
                      <th className="py-2 pr-4">Region</th>
                      <th className="py-2 pr-4">AI Enabled</th>
                      <th className="py-2 pr-4">Last Updated</th>
                      <th className="py-2 pr-4">Updated By</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regions.map((row) => (
                      <tr
                        key={`${row.country_code}/${row.region_code}`}
                        className="border-b border-slate-100"
                      >
                        <td className="py-3 pr-4 font-medium text-slate-900">{row.country_code}</td>
                        <td className="py-3 pr-4 text-slate-700">
                          {row.state_code ?? (row.region_type === "state" ? row.region_code.toUpperCase() : "—")}
                        </td>
                        <td className="py-3 pr-4 text-slate-700">
                          {row.region_name}{" "}
                          <span className="text-slate-400">({row.region_code})</span>
                        </td>
                        <td className="py-3 pr-4">
                          <AiBadge enabled={row.ai_enabled} />
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {row.ai_enabled_updated_at
                            ? new Date(row.ai_enabled_updated_at).toLocaleString()
                            : "—"}
                        </td>
                        <td className="py-3 pr-4 text-slate-600">
                          {row.updated_by_name ?? "—"}
                        </td>
                        <td className="py-3">
                          {canEdit ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={savingKey != null || row.ai_enabled}
                                onClick={() => void patchRegion(row, true)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                              >
                                Enable
                              </button>
                              <button
                                type="button"
                                disabled={savingKey != null || !row.ai_enabled}
                                onClick={() => void patchRegion(row, false)}
                                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-700 disabled:opacity-50"
                              >
                                Disable
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">Read-only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminGate>
  );
}
