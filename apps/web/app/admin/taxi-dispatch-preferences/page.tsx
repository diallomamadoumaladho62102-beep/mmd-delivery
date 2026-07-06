"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiDrivers } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import {
  DEFAULT_PREFERENCE_DROP_ORDER,
  TAXI_CLIENT_PREFERENCE_KEYS,
  TAXI_CLIENT_PREFERENCE_LABELS,
  type TaxiClientPreferenceKey,
} from "@/lib/taxiClientPreferences";

type RuleRow = {
  id: string;
  country_code: string | null;
  city: string | null;
  widen_delay_seconds: number;
  preference_drop_order: string[];
  enabled_preferences: Record<string, boolean>;
  is_active: boolean;
  updated_at: string | null;
};

type StatRow = {
  stat_date: string;
  country_code: string | null;
  city: string | null;
  rides_total: number;
  rides_electric: number;
  rides_hybrid: number;
  rides_child_seat: number;
  rides_wheelchair: number;
  rides_large_luggage: number;
  rides_non_smoking: number;
  ambiance_quiet: number;
  ambiance_music: number;
  ambiance_conversation: number;
};

function ruleScopeLabel(rule: RuleRow): string {
  if (!rule.country_code && !rule.city) return "GLOBAL";
  if (rule.country_code && !rule.city) return `${rule.country_code} (pays)`;
  return `${rule.country_code} / ${rule.city}`;
}

function enabledPreferencesFromForm(form: FormData): Record<string, boolean> {
  const enabled: Record<string, boolean> = {};
  for (const key of TAXI_CLIENT_PREFERENCE_KEYS) {
    enabled[key] = form.get(`pref_${key}`) === "on";
  }
  return enabled;
}

export default function AdminTaxiDispatchPreferencesPage() {
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [stats, setStats] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newCountry, setNewCountry] = useState("");
  const [newCity, setNewCity] = useState("");

  const sortedRules = useMemo(
    () =>
      [...rules].sort((a, b) => {
        const aGlobal = !a.country_code && !a.city ? 0 : 1;
        const bGlobal = !b.country_code && !b.city ? 0 : 1;
        if (aGlobal !== bGlobal) return aGlobal - bGlobal;
        const aCountry = String(a.country_code ?? "");
        const bCountry = String(b.country_code ?? "");
        if (aCountry !== bCountry) return aCountry.localeCompare(bCountry);
        return String(a.city ?? "").localeCompare(String(b.city ?? ""));
      }),
    [rules],
  );

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiDrivers(session?.role ?? null));
    const res = await adminFetch("/api/admin/taxi-dispatch-preferences");
    const body = await res.json().catch(() => ({}));
    setRules(body.rules ?? []);
    setStats(body.stats ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRule(e: FormEvent<HTMLFormElement>, rule: RuleRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    setSavingId(rule.id);
    try {
      const dropOrderRaw = String(form.get("preference_drop_order") ?? "").trim();
      const dropOrder = dropOrderRaw
        ? dropOrderRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : rule.preference_drop_order;

      const res = await adminFetch("/api/admin/taxi-dispatch-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rule_id: rule.id,
          widen_delay_seconds: Number(form.get("widen_delay_seconds")),
          preference_drop_order: dropOrder,
          enabled_preferences: enabledPreferencesFromForm(form),
          is_active: form.get("is_active") === "on",
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) alert(json.error ?? "Échec");
      else await load();
    } finally {
      setSavingId(null);
    }
  }

  async function createRule(scope: "country" | "city") {
    if (!canEdit) return;
    setCreating(true);
    try {
      const res = await adminFetch("/api/admin/taxi-dispatch-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country_code: newCountry.trim() || null,
          city: scope === "city" ? newCity.trim() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        alert(json.error ?? "Échec création");
        return;
      }
      setNewCity("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_drivers.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Taxi Dispatch Preferences</h1>
            <p className="mt-1 text-sm text-slate-600">
              Configuration sans code — priorité Ville → Pays → Global. Préférences client,
              délais d&apos;élargissement et statistiques.
            </p>
          </header>

          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <>
              {canEdit ? (
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-lg font-semibold text-slate-800">Créer une règle</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Laissez pays et ville vides pour une règle globale (déjà présente par défaut).
                  </p>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <label className="block text-sm">
                      <span className="text-slate-600">Code pays (ex. FR, US)</span>
                      <input
                        value={newCountry}
                        onChange={(e) => setNewCountry(e.target.value.toUpperCase())}
                        className="mt-1 w-full rounded border border-slate-300 px-3 py-2 uppercase"
                        placeholder="FR"
                      />
                    </label>
                    <label className="block text-sm md:col-span-2">
                      <span className="text-slate-600">Ville (optionnel — règle ville)</span>
                      <input
                        value={newCity}
                        onChange={(e) => setNewCity(e.target.value)}
                        className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                        placeholder="Paris"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={creating || !newCountry.trim()}
                      onClick={() => void createRule("country")}
                      className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Créer règle pays
                    </button>
                    <button
                      type="button"
                      disabled={creating || !newCountry.trim() || !newCity.trim()}
                      onClick={() => void createRule("city")}
                      className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                    >
                      Créer règle ville
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="space-y-4">
                <h2 className="text-lg font-semibold text-slate-800">Règles dispatch</h2>
                {sortedRules.length === 0 ? (
                  <p className="text-sm text-slate-500">Aucune règle.</p>
                ) : (
                  sortedRules.map((rule) => (
                    <form
                      key={rule.id}
                      onSubmit={(e) => void saveRule(e, rule)}
                      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {ruleScopeLabel(rule)}
                        </span>
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            name="is_active"
                            defaultChecked={rule.is_active}
                            disabled={!canEdit}
                          />
                          Active
                        </label>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="block text-sm">
                          <span className="text-slate-600">Délai élargissement (secondes)</span>
                          <input
                            name="widen_delay_seconds"
                            type="number"
                            min={5}
                            defaultValue={rule.widen_delay_seconds}
                            disabled={!canEdit}
                            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
                          />
                        </label>
                        <label className="block text-sm md:col-span-2">
                          <span className="text-slate-600">
                            Ordre suppression (clés séparées par virgule)
                          </span>
                          <textarea
                            name="preference_drop_order"
                            rows={2}
                            defaultValue={(rule.preference_drop_order ?? DEFAULT_PREFERENCE_DROP_ORDER).join(", ")}
                            disabled={!canEdit}
                            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 font-mono text-xs"
                          />
                        </label>
                      </div>

                      <div className="mt-4">
                        <p className="text-sm font-medium text-slate-700">Préférences disponibles</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          {TAXI_CLIENT_PREFERENCE_KEYS.map((key: TaxiClientPreferenceKey) => (
                            <label
                              key={key}
                              className="flex items-center justify-between rounded border border-slate-100 px-3 py-2 text-sm"
                            >
                              <span>
                                {TAXI_CLIENT_PREFERENCE_LABELS[key].emoji}{" "}
                                {TAXI_CLIENT_PREFERENCE_LABELS[key].label}
                              </span>
                              <input
                                type="checkbox"
                                name={`pref_${key}`}
                                defaultChecked={rule.enabled_preferences?.[key] !== false}
                                disabled={!canEdit}
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      {canEdit ? (
                        <button
                          type="submit"
                          disabled={savingId === rule.id}
                          className="mt-4 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {savingId === rule.id ? "Enregistrement…" : "Enregistrer"}
                        </button>
                      ) : null}
                    </form>
                  ))
                )}
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-semibold text-slate-800">Statistiques d&apos;utilisation</h2>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Pays</th>
                        <th className="px-3 py-2">Ville</th>
                        <th className="px-3 py-2">Courses</th>
                        <th className="px-3 py-2">Électrique</th>
                        <th className="px-3 py-2">Hybride</th>
                        <th className="px-3 py-2">Siège enfant</th>
                        <th className="px-3 py-2">Non-fumeur</th>
                        <th className="px-3 py-2">Calme</th>
                        <th className="px-3 py-2">Musique</th>
                        <th className="px-3 py-2">Discussion</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.map((row) => (
                        <tr
                          key={`${row.stat_date}-${row.country_code ?? "global"}-${row.city ?? ""}`}
                          className="border-b"
                        >
                          <td className="px-3 py-2">{row.stat_date}</td>
                          <td className="px-3 py-2">{row.country_code ?? "—"}</td>
                          <td className="px-3 py-2">{row.city ?? "—"}</td>
                          <td className="px-3 py-2">{row.rides_total}</td>
                          <td className="px-3 py-2">{row.rides_electric}</td>
                          <td className="px-3 py-2">{row.rides_hybrid}</td>
                          <td className="px-3 py-2">{row.rides_child_seat}</td>
                          <td className="px-3 py-2">{row.rides_non_smoking}</td>
                          <td className="px-3 py-2">{row.ambiance_quiet}</td>
                          <td className="px-3 py-2">{row.ambiance_music}</td>
                          <td className="px-3 py-2">{row.ambiance_conversation}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
