"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiTaxes } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type TaxRow = {
  id: string;
  country_code: string;
  tax_name: string;
  tax_rate: number;
  active: boolean;
  applies_to: string;
};

export default function AdminTaxiTaxesPage() {
  const [rows, setRows] = useState<TaxRow[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiTaxes(session?.role ?? null));
    const res = await adminFetch("/api/admin/taxi-taxes");
    const body = await res.json().catch(() => ({}));
    setRows(body.items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () =>
      rows.filter((row) => !filter || row.country_code === filter),
    [rows, filter]
  );

  async function saveRow(e: FormEvent<HTMLFormElement>, row: TaxRow) {
    e.preventDefault();
    if (!canEdit) return;
    const form = new FormData(e.currentTarget);
    const res = await adminFetch("/api/admin/taxi-taxes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: row.id,
        active: form.get("active") === "on",
        tax_rate: Number(form.get("tax_rate")),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) alert(json.error ?? "Échec");
    else await load();
  }

  const countries = useMemo(
    () => Array.from(new Set(rows.map((r) => r.country_code))).sort(),
    [rows]
  );

  return (
    <AdminGate requiredPermission="taxi_taxes.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold">Taxi Taxes</h1>
            <p className="text-sm text-slate-600">Taxes par pays (placeholders MVP).</p>
          </header>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
          >
            <option value="">Tous les pays</option>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          {loading ? (
            <p className="text-sm text-slate-500">Chargement…</p>
          ) : (
            <div className="space-y-4">
              {visible.map((row) => (
                <form
                  key={row.id}
                  onSubmit={(e) => void saveRow(e, row)}
                  className="rounded-2xl border bg-white p-4"
                >
                  <div className="mb-2 flex justify-between">
                    <strong>
                      {row.country_code} · {row.tax_name}
                    </strong>
                    <label className="text-sm">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={row.active}
                        disabled={!canEdit}
                      />{" "}
                      Actif
                    </label>
                  </div>
                  <label className="block text-sm">
                    Taux (%)
                    <input
                      name="tax_rate"
                      type="number"
                      step="0.001"
                      defaultValue={row.tax_rate}
                      disabled={!canEdit}
                      className="mt-1 w-full rounded-lg border px-2 py-1"
                    />
                  </label>
                  {canEdit ? (
                    <button type="submit" className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white">
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
