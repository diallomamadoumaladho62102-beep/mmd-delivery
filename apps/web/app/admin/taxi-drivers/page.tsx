"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiDrivers } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";

type TaxiDriverRow = {
  user_id: string;
  taxi_enabled: boolean;
  vehicle_class: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_plate: string | null;
  vehicle_color: string | null;
  passenger_capacity: number;
  xl_eligible: boolean;
  premium_eligible: boolean;
  profile: {
    full_name: string | null;
    phone: string | null;
    account_status: string | null;
  } | null;
};

export default function AdminTaxiDriversPage() {
  const [rows, setRows] = useState<TaxiDriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const session = await resolveBrowserStaffSession();
    setCanEdit(canManageTaxiDrivers(session?.role ?? null));

    const url = new URL("/api/admin/taxi-drivers", window.location.origin);
    if (query.trim()) url.searchParams.set("q", query.trim());

    const res = await adminFetch(url.toString());
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(body.items ?? []);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveRow(e: FormEvent<HTMLFormElement>, userId: string) {
    e.preventDefault();
    if (!canEdit) return;

    const form = new FormData(e.currentTarget);
    setSavingId(userId);

    try {
      const res = await adminFetch("/api/admin/taxi-drivers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          taxi_enabled: form.get("taxi_enabled") === "on",
          xl_eligible: form.get("xl_eligible") === "on",
          premium_eligible: form.get("premium_eligible") === "on",
          vehicle_class: String(form.get("vehicle_class") ?? "standard"),
          passenger_capacity: Number(form.get("passenger_capacity") ?? 4),
          vehicle_make: String(form.get("vehicle_make") ?? ""),
          vehicle_model: String(form.get("vehicle_model") ?? ""),
          vehicle_year: Number(form.get("vehicle_year") || 0) || null,
          vehicle_plate: String(form.get("vehicle_plate") ?? ""),
          vehicle_color: String(form.get("vehicle_color") ?? ""),
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
    <AdminGate requiredPermission="taxi_drivers.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Taxi Drivers</h1>
            <p className="mt-1 text-sm text-slate-600">
              Activation taxi, classes véhicule et éligibilité XL / premium.
            </p>
          </header>

          <div className="flex gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher nom / téléphone…"
              className="h-10 max-w-md flex-1 rounded-xl border border-slate-300 px-3 text-sm"
            />
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Actualiser
            </button>
          </div>

          {loading ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              Aucun chauffeur taxi configuré.
            </div>
          ) : (
            <div className="space-y-4">
              {rows.map((row) => (
                <form
                  key={row.user_id}
                  onSubmit={(e) => void saveRow(e, row.user_id)}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {row.profile?.full_name ?? "—"}
                      </div>
                      <div className="font-mono text-xs text-slate-500">{row.user_id}</div>
                      <div className="text-xs text-slate-500">
                        {row.profile?.phone ?? "—"} · {row.profile?.account_status ?? "—"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="taxi_enabled"
                          defaultChecked={row.taxi_enabled}
                          disabled={!canEdit}
                        />
                        taxi_enabled
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="xl_eligible"
                          defaultChecked={row.xl_eligible}
                          disabled={!canEdit}
                        />
                        xl_eligible
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="premium_eligible"
                          defaultChecked={row.premium_eligible}
                          disabled={!canEdit}
                        />
                        premium_eligible
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                    <label>
                      Classe
                      <select
                        name="vehicle_class"
                        defaultValue={row.vehicle_class}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                      >
                        <option value="standard">standard</option>
                        <option value="xl">xl</option>
                        <option value="premium">premium</option>
                      </select>
                    </label>
                    <label>
                      Capacité
                      <input
                        name="passenger_capacity"
                        type="number"
                        defaultValue={row.passenger_capacity}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                      />
                    </label>
                    <label>
                      Marque
                      <input
                        name="vehicle_make"
                        defaultValue={row.vehicle_make ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                      />
                    </label>
                    <label>
                      Modèle
                      <input
                        name="vehicle_model"
                        defaultValue={row.vehicle_model ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                      />
                    </label>
                    <label>
                      Année
                      <input
                        name="vehicle_year"
                        type="number"
                        defaultValue={row.vehicle_year ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                      />
                    </label>
                    <label>
                      Plaque
                      <input
                        name="vehicle_plate"
                        defaultValue={row.vehicle_plate ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                      />
                    </label>
                    <label>
                      Couleur
                      <input
                        name="vehicle_color"
                        defaultValue={row.vehicle_color ?? ""}
                        disabled={!canEdit}
                        className="mt-1 w-full rounded-xl border px-3 py-2"
                      />
                    </label>
                  </div>

                  {canEdit ? (
                    <button
                      type="submit"
                      disabled={savingId === row.user_id}
                      className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {savingId === row.user_id ? "Enregistrement…" : "Enregistrer"}
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
