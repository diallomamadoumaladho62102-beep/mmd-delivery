"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { canManageTaxiDrivers } from "@/lib/adminAccess";
import { adminFetch, resolveBrowserStaffSession } from "@/lib/adminBrowserAuth";
import { TAXI_CATEGORY_LABELS, type TaxiCategory } from "@/lib/driverServicePreferencesTypes";

type VehicleRow = {
  id: string;
  driver_user_id: string;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  license_plate: string | null;
  seats_count: number;
  vehicle_type: string | null;
  admin_review_status: string;
  profile: { full_name: string | null; phone: string | null } | null;
  categories: Array<{
    category: TaxiCategory;
    status: string;
    reason_message: string | null;
    admin_approved: boolean;
    admin_suspended: boolean;
  }>;
};

export default function AdminDriverVehiclesPage() {
  const [rows, setRows] = useState<VehicleRow[]>([]);
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

    const url = new URL("/api/admin/driver-vehicles", window.location.origin);
    if (query.trim()) url.searchParams.set("q", query.trim());

    const res = await adminFetch(url.toString());
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setRows([]);
    } else {
      setRows(body.items ?? []);
    }
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchVehicle(payload: Record<string, unknown>) {
    setSavingId(String(payload.vehicle_id));
    const res = await adminFetch("/api/admin/driver-vehicles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSavingId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error ?? "Échec");
      return;
    }
    await load();
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    void load();
  }

  return (
    <AdminGate requiredPermission="taxi_drivers.read">
      <div className="mx-auto max-w-6xl p-6">
        <h1 className="text-2xl font-semibold">Véhicules chauffeurs & catégories taxi</h1>
        <p className="mt-2 text-sm text-slate-600">
          Approuver véhicules, catégories Standard / Comfort / XL / Wheelchair, documents et règles d&apos;âge.
        </p>

        <form onSubmit={onSearch} className="mt-4 flex gap-2">
          <input
            className="flex-1 rounded border px-3 py-2"
            placeholder="Rechercher nom ou plaque"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="rounded bg-orange-500 px-4 py-2 text-white">
            Rechercher
          </button>
        </form>

        {loading && <p className="mt-6">Chargement…</p>}
        {error && <p className="mt-6 text-red-600">{error}</p>}

        <div className="mt-6 space-y-4">
          {rows.map((row) => (
            <div key={row.id} className="rounded border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{row.profile?.full_name ?? row.driver_user_id}</div>
                  <div className="text-sm text-slate-600">
                    {row.vehicle_make} {row.vehicle_model} {row.vehicle_year} · {row.seats_count} places ·{" "}
                    {row.license_plate ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500">Review: {row.admin_review_status}</div>
                </div>
                {canEdit && (
                  <div className="flex gap-2">
                    <button
                      disabled={savingId === row.id}
                      className="rounded bg-green-600 px-3 py-1 text-sm text-white"
                      onClick={() =>
                        void patchVehicle({
                          vehicle_id: row.id,
                          action: "approve_vehicle",
                          inspection_status: "approved",
                          insurance_status: "approved",
                          registration_status: "approved",
                        })
                      }
                    >
                      Approuver véhicule
                    </button>
                    <button
                      disabled={savingId === row.id}
                      className="rounded bg-red-600 px-3 py-1 text-sm text-white"
                      onClick={() =>
                        void patchVehicle({
                          vehicle_id: row.id,
                          action: "reject_vehicle",
                          notes: "Non conforme",
                        })
                      }
                    >
                      Refuser
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {row.categories.map((cat) => (
                  <div key={cat.category} className="rounded bg-slate-50 p-3 text-sm">
                    <div className="font-medium">{TAXI_CATEGORY_LABELS[cat.category]}</div>
                    <div>Statut: {cat.status}</div>
                    {cat.reason_message && (
                      <div className="text-xs text-slate-600">{cat.reason_message}</div>
                    )}
                    {canEdit && (
                      <div className="mt-2 flex gap-2">
                        <button
                          className="rounded bg-blue-600 px-2 py-1 text-xs text-white"
                          onClick={() =>
                            void patchVehicle({
                              vehicle_id: row.id,
                              category: cat.category,
                              action: "approve_category",
                            })
                          }
                        >
                          Approuver catégorie
                        </button>
                        <button
                          className="rounded bg-amber-600 px-2 py-1 text-xs text-white"
                          onClick={() =>
                            void patchVehicle({
                              vehicle_id: row.id,
                              category: cat.category,
                              action: "suspend_category",
                            })
                          }
                        >
                          Suspendre
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminGate>
  );
}
