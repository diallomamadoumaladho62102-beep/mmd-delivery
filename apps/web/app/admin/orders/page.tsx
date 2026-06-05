"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import AdminGate from "@/components/AdminGate";

type Order = {
  id: string;
  status: string | null;
  payment_status: string | null;
  subtotal: number | null;
  total: number | null;
  currency: string | null;
  restaurant_name: string | null;
  created_at: string;
};

function formatMoney(value: number | null | undefined, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value ?? 0);
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function AdminOrdersPage() {
  const [rows, setRows] = useState<Order[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async (statusFilter: string) => {
    const url = new URL("/api/admin/orders", window.location.origin);
    if (statusFilter) url.searchParams.set("status", statusFilter);

    const res = await fetch(url.toString(), { cache: "no-store" });
    const body = await res.json().catch(() => ({}));

    if (!res.ok || !body.ok) {
      throw new Error(body.error ?? "Failed to load orders");
    }

    return (body.items ?? []) as Order[];
  }, []);

  const loadPage = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      try {
        if (mode === "initial") setLoading(true);
        else setRefreshing(true);

        setError(null);
        const orders = await loadOrders(status);
        setRows(orders);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        setRows([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadOrders, status]
  );

  useEffect(() => {
    void loadPage("initial");
  }, [loadPage]);

  return (
    <AdminGate requiredPermission="orders.read">
      <main className="min-h-screen bg-slate-50">
        <div className="mx-auto max-w-5xl space-y-6 p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
                MMD Delivery · Admin Orders
              </div>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">
                Commandes food
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Liste via API admin (service_role) — filtre, détail et timeline.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadPage("refresh")}
              disabled={refreshing}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
            >
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-sm text-slate-500">
              Chargement…
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-6 shadow-sm text-sm text-red-700">
              {error}
            </div>
          ) : (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                  <div className="sm:w-72">
                    <label className="mb-2 block text-sm font-medium text-slate-700">
                      Filtre statut
                    </label>
                    <select
                      className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">(tous)</option>
                      <option value="pending">pending</option>
                      <option value="assigned">assigned</option>
                      <option value="accepted">accepted</option>
                      <option value="prepared">prepared</option>
                      <option value="ready">ready</option>
                      <option value="dispatched">dispatched</option>
                      <option value="delivered">delivered</option>
                      <option value="canceled">canceled</option>
                    </select>
                  </div>
                  <div className="text-sm text-slate-600">
                    {rows.length} commande{rows.length > 1 ? "s" : ""}
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {rows.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm md:col-span-2">
                    Aucune commande pour ce filtre.
                  </div>
                ) : (
                  rows.map((order) => (
                    <div
                      key={order.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <div className="font-semibold text-slate-900">
                        #{order.id.slice(0, 8)}
                      </div>
                      <div className="mt-2 text-sm text-slate-600">
                        Statut: <b>{order.status ?? "—"}</b> · Paiement:{" "}
                        <b>{order.payment_status ?? "—"}</b>
                      </div>
                      {order.restaurant_name ? (
                        <div className="text-sm text-slate-600">
                          {order.restaurant_name}
                        </div>
                      ) : null}
                      <div className="text-sm text-slate-600">
                        Total:{" "}
                        {formatMoney(
                          order.total ?? order.subtotal,
                          order.currency ?? "USD"
                        )}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatDate(order.created_at)}
                      </div>
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className="mt-2 inline-block text-sm font-medium text-blue-600 underline"
                      >
                        Ouvrir
                      </Link>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      </main>
    </AdminGate>
  );
}
