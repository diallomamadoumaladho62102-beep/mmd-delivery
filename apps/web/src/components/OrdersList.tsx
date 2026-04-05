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

type Role = "client" | "restaurant" | "driver" | "admin" | "unknown";

type OrderRow = {
  id: string;
  status: OrderStatus;
  subtotal: number;
  tax: number | null;
  total: number | null;
  currency: string;
  restaurant_name?: string | null;
  created_at?: string | null;
};

type OrderListItem = {
  order: OrderRow;
  role: Role;
};

export default function OrdersList() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "past">(
    "all"
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      // ---- Récupérer l'utilisateur connecté ----
      const { data: userData, error: userError } =
        await supabase.auth.getUser();

      if (userError || !userData.user) {
        if (!cancelled) {
          setErr("Tu dois être connecté pour voir tes commandes.");
          setLoading(false);
        }
        return;
      }

      const userId = userData.user.id;

      // ---- Récupérer les memberships (order_members) ----
      const { data: memberRows, error: memberError } = await supabase
        .from("order_members")
        .select("order_id, role")
        .eq("user_id", userId);

      if (memberError) {
        if (!cancelled) {
          console.error("order_members error", memberError);
          setErr(memberError.message);
          setLoading(false);
        }
        return;
      }

      if (!memberRows || memberRows.length === 0) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }

      const orderIds = memberRows.map((m: any) => m.order_id as string);

      // ---- Charger les commandes correspondantes
      // ⚠️ IMPORTANT : on NE PREND PAS les commandes livrées / annulées
      const { data: orderRows, error: ordersError } = await supabase
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
          created_at
        `
        )
        .in("id", orderIds)
        .not("status", "in", "(delivered,canceled)");

      if (ordersError) {
        if (!cancelled) {
          console.error("orders error", ordersError);
          setErr(ordersError.message);
          setLoading(false);
        }
        return;
      }

      const roleByOrderId = new Map<string, Role>();

      memberRows.forEach((m: any) => {
        const oid = m.order_id as string;
        const r = (m.role as Role) ?? "unknown";
        if (!roleByOrderId.has(oid)) {
          roleByOrderId.set(oid, r);
        }
      });

      const combined: OrderListItem[] = (orderRows || []).map((o: any) => ({
        order: o,
        role: roleByOrderId.get(o.id) ?? "unknown",
      }));

      // ---- Trier par date (les plus récentes en premier) ----
      combined.sort((a, b) => {
        const da = a.order.created_at
          ? new Date(a.order.created_at).getTime()
          : 0;
        const db = b.order.created_at
          ? new Date(b.order.created_at).getTime()
          : 0;
        return db - da;
      });

      if (!cancelled) {
        setItems(combined);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  const statusLabel: Record<OrderStatus, string> = {
    pending: "En attente",
    accepted: "Acceptée par le restaurant",
    prepared: "En préparation",
    ready: "Prête à récupérer",
    dispatched: "En livraison",
    delivered: "Livrée",
    canceled: "Annulée",
  };

  const roleLabel: Record<Role, string> = {
    client: "Client",
    restaurant: "Restaurant",
    driver: "Chauffeur / livreur",
    admin: "Admin",
    unknown: "Inconnu",
  };

  // Même si on garde le petit système de filtres,
  // en pratique il n'y aura QUE des commandes en cours,
  // car on a déjà filtré delivered/canceled dans la requête.
  const filteredItems = useMemo(() => {
    return items.filter(({ order }) => {
      const isFinished =
        order.status === "delivered" || order.status === "canceled";

      if (statusFilter === "all") return true;
      if (statusFilter === "active") return !isFinished;
      if (statusFilter === "past") return isFinished;

      return true;
    });
  }, [items, statusFilter]);

  if (loading) {
    return (
      <div className="text-sm text-gray-600">
        Chargement de tes commandes…
      </div>
    );
  }

  if (err) {
    return (
      <div className="text-sm text-red-600">
        Erreur : {err}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="text-sm text-gray-600">
        Tu n&apos;as encore aucune commande.
        <br />
        <Link href="/orders/new" className="text-emerald-700 underline">
          Crée ta première commande →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ONGLET DE FILTRE */}
      <div className="inline-flex rounded-full bg-gray-100 p-1 text-xs font-medium">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`px-3 py-1 rounded-full ${
            statusFilter === "all"
              ? "bg-white shadow-sm text-gray-900"
              : "text-gray-600"
          }`}
        >
          Toutes (en cours)
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("active")}
          className={`px-3 py-1 rounded-full ${
            statusFilter === "active"
              ? "bg-white shadow-sm text-gray-900"
              : "text-gray-600"
          }`}
        >
          En cours
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("past")}
          className={`px-3 py-1 rounded-full ${
            statusFilter === "past"
              ? "bg-white shadow-sm text-gray-900"
              : "text-gray-600"
          }`}
          disabled
        >
          Terminées / annulées
        </button>
      </div>

      {/* LISTE DES COMMANDES */}
      <div className="space-y-3">
        {filteredItems.length === 0 ? (
          <p className="text-sm text-gray-600">
            Aucune commande en cours à afficher.
          </p>
        ) : (
          filteredItems.map(({ order, role }) => {
            const createdAtLabel =
              order.created_at &&
              new Date(order.created_at).toLocaleString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

            const total = order.total ?? order.subtotal + (order.tax ?? 0);
            const currency = order.currency || "USD";

            return (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="block border rounded-xl bg-white hover:shadow-sm transition-shadow p-3 text-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-gray-500">
                      #{order.id.slice(0, 8)}
                    </p>
                    <p className="text-sm font-semibold">
                      {order.restaurant_name ?? "Restaurant inconnu"}
                    </p>
                    {createdAtLabel && (
                      <p className="text-[11px] text-gray-500">
                        Créée le : {createdAtLabel}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-500 mt-1">
                      Rôle :{" "}
                      <span className="font-semibold">
                        {roleLabel[role]}
                      </span>
                    </p>
                  </div>

                  <div className="text-right space-y-1">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] border bg-amber-50 text-amber-700 border-amber-200`}
                    >
                      {statusLabel[order.status] ?? order.status}
                    </span>
                    <p className="text-sm font-semibold">
                      {total.toFixed(2)} {currency}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
