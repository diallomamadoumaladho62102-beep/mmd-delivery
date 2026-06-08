"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import AdminGate from "@/components/AdminGate";
import { adminFetch } from "@/lib/adminBrowserAuth";

type TaxiRideRow = {
  id: string;
  status: string | null;
  vehicle_class: string | null;
  payment_status: string | null;
  refund_status: string | null;
  total_cents: number | null;
  currency: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  created_at: string;
};

function formatMoney(cents: number | null, currency = "USD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export default function AdminTaxiRidesPage() {
  const [rows, setRows] = useState<TaxiRideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [vehicleClass, setVehicleClass] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const url = new URL("/api/admin/taxi-rides", window.location.origin);
    if (status) url.searchParams.set("status", status);
    if (vehicleClass) url.searchParams.set("vehicle_class", vehicleClass);
    if (paymentStatus) url.searchParams.set("payment_status", paymentStatus);
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
  }, [status, vehicleClass, paymentStatus, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AdminGate requiredPermission="taxi_rides.read">
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">Taxi Rides</h1>
            <p className="mt-1 text-sm text-slate-600">
              Courses taxi, filtres et accès détail admin.
            </p>
          </header>

          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-5">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Tous statuts</option>
              <option value="draft">draft</option>
              <option value="searching">searching</option>
              <option value="accepted">accepted</option>
              <option value="driver_arrived">driver_arrived</option>
              <option value="in_progress">in_progress</option>
              <option value="completed">completed</option>
              <option value="canceled">canceled</option>
            </select>

            <select
              value={vehicleClass}
              onChange={(e) => setVehicleClass(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Toutes classes</option>
              <option value="standard">standard</option>
              <option value="xl">xl</option>
              <option value="premium">premium</option>
            </select>

            <select
              value={paymentStatus}
              onChange={(e) => setPaymentStatus(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Tous paiements</option>
              <option value="unpaid">unpaid</option>
              <option value="paid">paid</option>
              <option value="refunded">refunded</option>
            </select>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher ID / adresse…"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
            />
          </div>

          <div className="flex gap-3">
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
              Aucune course taxi.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Classe</th>
                    <th className="px-4 py-3">Paiement</th>
                    <th className="px-4 py-3">Remboursement</th>
                    <th className="px-4 py-3">Total</th>
                    <th className="px-4 py-3">Créé</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/taxi-rides/${row.id}`}
                          className="font-mono text-xs text-blue-700 underline"
                        >
                          {row.id.slice(0, 8)}…
                        </Link>
                      </td>
                      <td className="px-4 py-3">{row.status ?? "—"}</td>
                      <td className="px-4 py-3">{row.vehicle_class ?? "—"}</td>
                      <td className="px-4 py-3">{row.payment_status ?? "—"}</td>
                      <td className="px-4 py-3">{row.refund_status ?? "—"}</td>
                      <td className="px-4 py-3">
                        {formatMoney(row.total_cents, row.currency ?? "USD")}
                      </td>
                      <td className="px-4 py-3">
                        {new Date(row.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
