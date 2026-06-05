"use client";

import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";

type OfferRow = {
  id: string;
  order_id?: string;
  delivery_request_id?: string;
  driver_id: string;
  status: string;
  wave: number | null;
  expires_at: string | null;
  created_at: string;
};

export default function AdminDriverOffersPage() {
  const [foodOffers, setFoodOffers] = useState<OfferRow[]>([]);
  const [drOffers, setDrOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await adminFetch("/api/admin/driver-offers");
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) {
      setError(body.error ?? "Échec chargement");
      setFoodOffers([]);
      setDrOffers([]);
    } else {
      setFoodOffers(body.food_offers ?? []);
      setDrOffers(body.delivery_request_offers ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function OfferTable({ title, rows }: { title: string; rows: OfferRow[] }) {
    return (
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Cible</th>
                <th className="px-4 py-3">Chauffeur</th>
                <th className="px-4 py-3">Statut</th>
                <th className="px-4 py-3">Vague</th>
                <th className="px-4 py-3">Expire</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    Aucune offre
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {(r.order_id ?? r.delivery_request_id ?? "—").slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {r.driver_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3">{r.status}</td>
                    <td className="px-4 py-3">{r.wave ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {r.expires_at
                        ? new Date(r.expires_at).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <AdminGate requiredPermission="driver_offers.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Driver Offers</h1>
              <p className="mt-1 text-sm text-slate-600">
                Offres envoyées aux chauffeurs (food orders + delivery requests).
              </p>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              className="h-10 rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white"
            >
              Actualiser
            </button>
          </header>

          {loading ? (
            <div className="text-sm text-slate-500">Chargement…</div>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <>
              <OfferTable title="Food orders" rows={foodOffers} />
              <OfferTable title="Delivery requests" rows={drOffers} />
            </>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
