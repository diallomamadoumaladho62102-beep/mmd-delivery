"use client";

import { useEffect, useMemo, useState } from "react";
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
  category?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
};

type OrderRow = {
  id: string;
  status: OrderStatus;
  subtotal: number;
  tax: number | null;
  total: number | null;
  currency: string;
  restaurant_name: string | null;
  created_at: string | null;
  items_json: OrderItem[] | null;
};

type Profile = {
  id: string;
  full_name: string | null;
};

const statusLabel: Record<OrderStatus, string> = {
  pending: "En attente",
  accepted: "Acceptée par le restaurant",
  prepared: "En préparation",
  ready: "Prête à récupérer",
  dispatched: "En livraison",
  delivered: "Livrée",
  canceled: "Annulée",
};

export default function RestaurantOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      // 1) Utilisateur connecté
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (!cancelled) {
          setErr(
            "Tu dois être connecté comme restaurant pour voir ces commandes."
          );
          setLoading(false);
        }
        return;
      }

      const userId = userData.user.id;

      // 2) Profil (nom du restaurant / propriétaire)
      const { data: prof, error: profError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", userId)
        .maybeSingle();

      if (!cancelled) {
        if (profError) {
          console.error("profError", profError);
        }
        setProfile(
          prof
            ? (prof as Profile)
            : { id: userId, full_name: userData.user.email ?? null }
        );
      }

      // 3) Commandes pour ce restaurant
      const { data: orderRows, error: orderError } = await supabase
        .from("orders")
        .select(
          `
          id,
          status,
          subtotal,
          tax,
          total,
          currency,
          restaurant_name,
          created_at,
          items_json
        `
        )
        .eq("restaurant_id", userId)
        .in("status", ["pending", "accepted", "prepared", "ready", "dispatched"])
        .order("created_at", { ascending: false });

      if (!cancelled) {
        if (orderError) {
          console.error("orderError", orderError);
          setErr(orderError.message);
          setOrders([]);
        } else {
          setOrders((orderRows || []) as OrderRow[]);
        }
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const hasActiveOrders = useMemo(() => orders.length > 0, [orders]);

  async function updateOrderStatus(orderId: string, nextStatus: OrderStatus) {
    setUpdatingId(orderId);
    setErr(null);
    try {
      const { data, error } = await supabase
        .from("orders")
        .update({ status: nextStatus })
        .eq("id", orderId)
        .select()
        .maybeSingle();

      if (error || !data) {
        console.error("update status error", error);
        throw error ?? new Error("Mise à jour du statut échouée.");
      }

      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? (data as OrderRow) : o))
      );
    } catch (e: any) {
      console.error(e);
      setErr(
        e?.message ?? "Erreur inattendue lors de la mise à jour du statut."
      );
    } finally {
      setUpdatingId(null);
    }
  }

  function renderActionsFor(order: OrderRow) {
    const current = order.status;
    const buttons: { label: string; next: OrderStatus }[] = [];

    if (current === "pending") {
      buttons.push({
        label: "Accepter la commande",
        next: "accepted",
      });
    } else if (current === "accepted") {
      buttons.push({
        label: "Commencer la préparation",
        next: "prepared",
      });
    } else if (current === "prepared") {
      buttons.push({
        label: "Marquer comme prête",
        next: "ready",
      });
    } else if (current === "ready") {
      // facultatif : le resto ne touche plus, le chauffeur prend le relais
      // On peut afficher un message seulement.
    }

    if (buttons.length === 0) {
      return (
        <p className="text-[11px] text-gray-500">
          Aucune action requise pour le moment sur cette commande.
        </p>
      );
    }

    return (
      <div className="flex flex-wrap gap-2 mt-1">
        {buttons.map((btn) => (
          <button
            key={btn.next}
            type="button"
            disabled={updatingId === order.id}
            onClick={() => updateOrderStatus(order.id, btn.next)}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            {updatingId === order.id ? "Mise à jour…" : btn.label}
          </button>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold">Commandes à préparer</h1>
        <p className="text-sm text-gray-600 mt-2">
          Chargement des commandes de ton restaurant…
        </p>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Commandes à préparer</h1>
          <p className="text-sm text-gray-600">
            Restaurant :{" "}
            <span className="font-semibold">
              {profile?.full_name ?? "Ton restaurant"}
            </span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Filtre : uniquement les commandes en cours (en attente, acceptées,
            en préparation, prêtes, en livraison).
          </p>
        </div>

        <Link
          href="/restaurants"
          className="inline-flex text-xs px-3 py-1.5 rounded-lg border hover:bg-gray-50"
        >
          ← Voir la page publique du restaurant
        </Link>
      </header>

      {err && (
        <p className="text-sm text-red-600">
          Erreur lors du chargement ou de la mise à jour : {err}
        </p>
      )}

      {!hasActiveOrders ? (
        <p className="text-sm text-gray-600">
          Aucune commande en cours pour le moment.
        </p>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const items = order.items_json ?? [];
            const shortId = order.id.slice(0, 8);
            const currency = order.currency || "USD";

            let createdAtText = order.created_at;
            if (order.created_at) {
              try {
                const d = new Date(order.created_at);
                createdAtText = d.toLocaleString("fr-FR", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                });
              } catch {
                // on garde le texte brut
              }
            }

            return (
              <article
                key={order.id}
                className="border rounded-lg p-3 bg-white space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      Commande #{shortId}
                    </p>
                    {createdAtText && (
                      <p className="text-[11px] text-gray-500">
                        Créée le {createdAtText}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      Montant :{" "}
                      <span className="font-semibold">
                        {order.subtotal.toFixed(2)} {currency}
                      </span>{" "}
                      — Total :{" "}
                      <span className="font-semibold">
                        {(order.total ??
                          order.subtotal + (order.tax ?? 0)
                        ).toFixed(2)}{" "}
                        {currency}
                      </span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border bg-gray-50">
                      {statusLabel[order.status] ?? order.status}
                    </p>
                  </div>
                </div>

                {/* Actions resto */}
                {renderActionsFor(order)}

                {/* Détails des plats */}
                <div className="pt-2 border-t mt-2 space-y-1">
                  <p className="text-xs font-semibold">Détails des plats :</p>
                  {items.length === 0 ? (
                    <p className="text-[11px] text-gray-500">
                      Aucun plat encore dans cette catégorie.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {items.map((item, idx) => (
                        <li
                          key={`${item.name}-${idx}`}
                          className="text-[11px] text-gray-700"
                        >
                          <span className="font-medium">{item.name}</span>{" "}
                          × {item.quantity}
                          {item.category && (
                            <span className="text-gray-500">
                              {" "}
                              • {item.category}
                            </span>
                          )}{" "}
                          —{" "}
                          <span className="font-semibold">
                            {item.line_total.toFixed(2)} {currency}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="pt-1">
                  <Link
                    href={`/restaurant/orders/${order.id}`}
                    className="inline-flex text-[11px] text-emerald-700 underline"
                  >
                    Voir la fiche complète de la commande →
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
