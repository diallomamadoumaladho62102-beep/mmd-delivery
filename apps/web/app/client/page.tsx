"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderRow = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
};

export default function ClientHomePage() {
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (!sessionData.session) {
        setError("Tu dois être connecté pour voir tes commandes.");
        setOrders([]);
        return;
      }

      const userId = sessionData.session.user.id;

      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          status,
          created_at,
          pickup_address,
          dropoff_address,
          distance_miles,
          total,
          delivery_fee,
          created_by
        `
        )
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("Erreur fetch orders client (web):", error);
        throw error;
      }

      setOrders((data as any as OrderRow[]) ?? []);
    } catch (e: any) {
      console.error("Erreur chargement commandes client (web):", e);
      setError(
        e?.message ?? "Impossible de charger tes commandes pour le moment."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  function formatStatus(status: OrderStatus) {
    switch (status) {
      case "pending":
        return "En attente";
      case "accepted":
        return "Acceptée";
      case "prepared":
        return "En préparation";
      case "ready":
        return "Prête";
      case "dispatched":
        return "En livraison";
      case "delivered":
        return "Livrée";
      case "canceled":
        return "Annulée";
      default:
        return status;
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* HEADER */}
        <header className="mb-6">
          <h1 className="text-3xl font-extrabold tracking-tight mb-1">
            Espace client
          </h1>
          <p className="text-sm text-slate-400">
            Crée une nouvelle commande MMD ou consulte ton historique.
          </p>
        </header>

        {/* BOUTON 1 : NOUVELLE COMMANDE PICKUP / DROPOFF */}
        <div className="flex flex-col gap-3 mb-6">
          <Link
            href="/orders/new"
            className="inline-flex w-full items-center justify-center rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-600 transition"
          >
            + Nouvelle commande pickup / dropoff
          </Link>

          {/* BOUTON 2 : COMMANDER DANS UN RESTAURANT (MENUS) */}
          <Link
            href="/orders/new"
            className="inline-flex w-full items-center justify-center rounded-full bg-blue-500 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-600 transition"
          >
            Commander dans un restaurant (menus)
          </Link>
        </div>

        {/* TITRE HISTORIQUE */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">
            Mes dernières commandes
          </h2>

          <button
            type="button"
            onClick={() => void fetchOrders()}
            className="text-xs font-medium text-blue-400 hover:text-blue-300"
          >
            Rafraîchir
          </button>
        </div>

        {/* ETAT DE CHARGEMENT / ERREUR */}
        {loading && (
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-300 border-t-transparent" />
            <span>Chargement de tes commandes...</span>
          </div>
        )}

        {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

        {/* LISTE DES COMMANDES */}
        {orders.length === 0 && !loading ? (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-6 text-center">
            <p className="text-sm text-slate-400">
              Tu n’as pas encore de commande MMD enregistrée avec ce compte.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Crée une première commande pickup / dropoff ou via un restaurant
              pour tester le système.
            </p>
          </div>
        ) : (
          <div className="space-y-3 mt-2">
            {orders.map((order) => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3 hover:border-slate-600 transition"
              >
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-100">
                    #{order.id.slice(0, 8)}
                  </span>
                  <span className="text-xs font-semibold text-blue-300">
                    {formatStatus(order.status)}
                  </span>
                </div>

                <p className="mb-2 text-[11px] text-slate-500">
                  {formatDate(order.created_at)}
                </p>

                <p className="text-xs text-slate-400">
                  Pickup :{" "}
                  <span className="font-medium text-slate-100">
                    {order.pickup_address ?? "—"}
                  </span>
                </p>
                <p className="mb-1 text-xs text-slate-400">
                  Dropoff :{" "}
                  <span className="font-medium text-slate-100">
                    {order.dropoff_address ?? "—"}
                  </span>
                </p>

                <div className="mt-1 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Distance :{" "}
                    <span className="font-semibold text-slate-100">
                      {order.distance_miles != null
                        ? `${order.distance_miles.toFixed(2)} mi`
                        : "—"}
                    </span>
                  </span>

                  <span>
                    Total :{" "}
                    <span className="font-bold text-slate-100">
                      {order.total != null
                        ? `${order.total.toFixed(2)} USD`
                        : order.delivery_fee != null
                        ? `${order.delivery_fee.toFixed(2)} USD`
                        : "—"}
                    </span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
