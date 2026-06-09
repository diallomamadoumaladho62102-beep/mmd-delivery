"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiCountries } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type CountryRow = {
  country_code: string;
  name: string;
  currency_code: string;
  active: boolean;
  sort_order: number;
  timezone: string | null;
  phone_country_code: string | null;
  default_language: string;
  updated_at: string | null;
};

export default function AdminTaxiCountriesPage() {
  const [rows, setRows] = useState<CountryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiCountries(session?.role ?? null));
    const res = await adminFetch("/api/admin/taxi-countries");
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(e: FormEvent<HTMLFormElement>, row: CountryRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    setSavingCode(row.country_code);
    try {
      const res = await adminFetch("/api/admin/taxi-countries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country_code: row.country_code,
          active: form.get("active") === "on",
          currency_code: form.get("currency_code"),
          timezone: form.get("timezone"),
          phone_country_code: form.get("phone_country_code"),
          default_language: form.get("default_language"),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) alert(json.error ?? "Échec");
      else await load();
    } finally {
      setSavingCode(null);
    }
  }

  return (
    <AdminGate requiredPermission="taxi_countries.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Taxi Countries</h1>
            <p className="mt-1 text-sm text-slate-600">
              Configuration pays — devise, langue, fuseau, téléphone.
            </p>
          </header>
          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {rows.map((row) => (
                <form
                  key={row.country_code}
                  onSubmit={(e) => void saveRow(e, row)}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h2 className="font-semibold text-slate-900">
                        {row.country_code} · {row.name}
                      </h2>
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
                  <div className="grid gap-2 text-sm">
                    <label>
                      Devise
                      <input
                        name="currency_code"
                        defaultValue={row.currency_code}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border px-2 py-1"
                      />
                    </label>
                    <label>
                      Langue
                      <select
                        name="default_language"
                        defaultValue={row.default_language}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border px-2 py-1"
                      >
                        <option value="en">EN</option>
                        <option value="fr">FR</option>
                      </select>
                    </label>
                    <label>
                      Fuseau
                      <input
                        name="timezone"
                        defaultValue={row.timezone ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border px-2 py-1"
                      />
                    </label>
                    <label>
                      Indicatif
                      <input
                        name="phone_country_code"
                        defaultValue={row.phone_country_code ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-lg border px-2 py-1"
                      />
                    </label>
                  </div>
                  {canEdit ? (
                    <button
                      type="submit"
                      disabled={savingCode === row.country_code}
                      className="mt-3 w-full rounded-xl bg-slate-900 py-2 text-sm text-white disabled:opacity-50"
                    >
                      Enregistrer
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
