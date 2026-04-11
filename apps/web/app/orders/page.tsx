"use client";

import { useEffect, useState } from "react";
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
  created_at: string;
  total: number | null;
  currency: string | null;
};

const ACTIVE_CLIENT_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
];

function statusLabel(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "En attente";
    case "accepted":
      return "Acceptée par le restaurant";
    case "prepared":
      return "En préparation";
    case "ready":
      return "Prête pour pickup";
    case "dispatched":
      return "En livraison";
    case "delivered":
      return "Livrée";
    case "canceled":
      return "Annulée";
    default:
      return s;
  }
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    // utilisateur connecté
    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError) {
      console.error(userError);
      setErr(userError.message);
      setLoading(false);
      return;
    }

    if (!userData.user) {
      setErr("Tu dois être connecté pour voir tes commandes.");
      setLoading(false);
      return;
    }

    const uid = userData.user.id;

    // 🔥 On récupère SEULEMENT les commandes EN COURS du client
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        status,
        created_at,
        total,
        currency
      `
      )
      .eq("user_id", uid) // le créateur de la commande (client)
      .in("status", ACTIVE_CLIENT_STATUSES) // MASQUE livrées + annulées
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      setErr(error.message);
      setLoading(false);
      return;
    }

    setOrders((data || []) as OrderRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">Mes commandes</h1>
        <button
          type="button"
          onClick={load}
          className="text-xs px-2 py-1 rounded border hover:bg-gray-50"
        >
          Rafraîchir
        </button>
      </div>

      {loading && (
        <p className="text-sm text-gray-600">
          Chargement de tes commandes en cours…
        </p>
      )}

      {err && (
        <p className="text-sm text-red-600">
          Erreur : {err}
        </p>
      )}

      {!loading && !err && orders.length === 0 && (
        <p className="text-sm text-gray-600">
          Tu n&apos;as aucune commande en cours pour le moment.
        </p>
      )}

      {!loading && !err && orders.length > 0 && (
        <section className="space-y-3">
          {orders.map((o) => {
            const shortId = o.id.slice(0, 8);

            return (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="block border rounded-xl bg-white p-4 hover:bg-gray-50"
              >
                <p className="text-sm font-semibold">
                  Commande #{shortId}
                </p>
                <p className="text-xs text-gray-500">
                  Créée le :{" "}
                  {new Date(o.created_at).toLocaleString("fr-FR")}
                </p>
                <p className="text-xs mt-1 text-gray-700">
                  Statut :{" "}
                  <span className="font-semibold">
                    {statusLabel(o.status)}
                  </span>
                </p>
                {o.total !== null && (
                  <p className="text-xs mt-1 text-gray-700">
                    Total :{" "}
                    <span className="font-semibold">
                      {o.total.toFixed(2)} {o.currency || "USD"}
                    </span>
                  </p>
                )}
              </Link>
            );
          })}
        </section>
      )}
    </main>
  );
}
