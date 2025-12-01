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

type OrderItem = {
  name: string;
  quantity: number;
  category?: string | null;
  line_total?: number | null;
};

type OrderRow = {
  id: string;
  status: OrderStatus;
  created_at: string;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  items_json: OrderItem[] | null;
  restaurant_name?: string | null;
};

type Me = {
  id: string;
  full_name: string | null;
};

export default function MyOrdersPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);

    // 1) récupérer l'utilisateur connecté
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError) {
      console.error(userError);
      setErr(userError.message);
      setLoading(false);
      return;
    }

    const user = userData.user;
    if (!user) {
      setErr("Tu dois te connecter pour voir tes commandes.");
      setLoading(false);
      return;
    }

    const uid = user.id;

    // 2) récupérer ton profil (nom)
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", uid)
      .maybeSingle();

    if (profileError) {
      console.error(profileError);
    } else if (profileRow) {
      setMe({
        id: profileRow.id,
        full_name: profileRow.full_name ?? null,
      });
    }

    // 3) récupérer TES commandes (côté client)
    // 👉 ici on suppose qu'il existe une colonne client_id dans orders
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select(
        `
        id,
        status,
        created_at,
        currency,
        subtotal,
        total,
        items_json,
        restaurant_name
      `
      )
      .eq("client_id", uid)
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error(ordersError);
      setErr(ordersError.message);
      setLoading(false);
      return;
    }

    setOrders((ordersData || []) as OrderRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function formatDate(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }

  function statusLabel(s: OrderStatus): string {
    switch (s) {
      case "pending":
        return "En attente (envoi au restaurant)";
      case "accepted":
        return "Acceptée par le restaurant";
      case "prepared":
        return "En préparation";
      case "ready":
        return "Prête (en attente du driver)";
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

  function statusClass(s: OrderStatus): string {
    switch (s) {
      case "pending":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "accepted":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "prepared":
        return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "ready":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "dispatched":
        return "bg-purple-50 text-purple-700 border-purple-200";
      case "delivered":
        return "bg-gray-100 text-gray-700 border-gray-200";
      case "canceled":
        return "bg-red-50 text-red-700 border-red-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mes commandes</h1>
          <p className="text-sm text-gray-600">
            Connecté en tant que{" "}
            <span className="font-medium">
              {me?.full_name || "client MMD Delivery"}
            </span>
          </p>
          <p className="text-xs text-gray-500">
            Historique et suivi de toutes tes commandes (en cours et passées).
          </p>
        </div>

        <button
          type="button"
          onClick={load}
          className="px-3 py-1.5 rounded-lg border text-sm bg-white hover:bg-gray-50"
        >
          Rafraîchir
        </button>
      </header>

      {loading && (
        <p className="text-sm text-gray-600">
          Chargement de tes commandes…
        </p>
      )}

      {err && (
        <p className="text-sm text-red-600">
          Erreur : {err}
        </p>
      )}

      {!loading && !err && orders.length === 0 && (
        <p className="text-sm text-gray-600">
          Tu n&apos;as pas encore de commande. Passe ta première commande pour la
          voir ici.
        </p>
      )}

      {!loading && !err && orders.length > 0 && (
        <section className="space-y-3">
          <p className="text-xs text-gray-500">
            {orders.length} commande
            {orders.length > 1 ? "s" : ""} trouvée
            {orders.length > 1 ? "s" : ""}.
          </p>

          <div className="space-y-3">
            {orders.map((order) => {
              const items = (order.items_json || []) as OrderItem[];
              const shortId = order.id.slice(0, 8);

              return (
                <article
                  key={order.id}
                  className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                >
                  {/* En-tête commande */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">
                        Commande #{shortId}
                      </p>
                      <p className="text-xs text-gray-500">
                        Créée le {formatDate(order.created_at)}
                      </p>
                      {order.restaurant_name && (
                        <p className="text-xs text-gray-600">
                          Restaurant :{" "}
                          <span className="font-medium">
                            {order.restaurant_name}
                          </span>
                        </p>
                      )}
                    </div>

                    <span
                      className={
                        "inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium " +
                        statusClass(order.status)
                      }
                    >
                      {statusLabel(order.status)}
                    </span>
                  </div>

                  {/* Détails des plats */}
                  {items.length > 0 && (
                    <div className="border rounded-lg p-2 bg-gray-50">
                      <p className="text-xs font-semibold mb-1">
                        Détails de la commande
                      </p>
                      <ul className="space-y-0.5">
                        {items.map((it, idx) => (
                          <li
                            key={idx}
                            className="text-xs text-gray-700 flex justify-between gap-2"
                          >
                            <span>
                              {it.quantity} × {it.name}
                              {it.category ? ` • ${it.category}` : ""}
                            </span>
                            {typeof it.line_total === "number" && (
                              <span className="text-gray-800">
                                {it.line_total.toFixed(2)}{" "}
                                {order.currency || "USD"}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Montants + actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-gray-700">
                    <div className="space-y-0.5">
                      {order.subtotal !== null && (
                        <p>
                          Sous-total :{" "}
                          <span className="font-medium">
                            {order.subtotal.toFixed(2)}{" "}
                            {order.currency || "USD"}
                          </span>
                        </p>
                      )}
                      {order.total !== null && (
                        <p>
                          Total :{" "}
                          <span className="font-semibold">
                            {order.total.toFixed(2)}{" "}
                            {order.currency || "USD"}
                          </span>
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 justify-end">
                      <Link
                        href={`/orders/${order.id}`}
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                      >
                        Voir la commande
                      </Link>
                      <Link
                        href={`/orders/${order.id}/chat`}
                        className="px-3 py-1.5 rounded-lg border bg-gray-900 text-white hover:bg-black"
                      >
                        Ouvrir le chat
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
