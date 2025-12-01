"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { OrderTimeline } from "@/components/orders/OrderTimeline";

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
  kind: string | null;
  user_id: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  created_at: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  delivery_fee: number | null;
  driver_delivery_payout: number | null;
  platform_delivery_fee: number | null;

  // 👇 champs pour la commission restaurant
  restaurant_commission_rate: number | null;
  restaurant_commission_amount: number | null;
  restaurant_net_amount: number | null;

  items_json: OrderItem[] | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
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
      return "En attente";
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

export default function AdminOrderPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;

    async function load() {
      setLoading(true);
      setErr(null);

      // 👉 Ici on suppose que RLS autorise les admins à lire toutes les commandes
      const { data, error } = await supabase
        .from("orders")
        .select(
          `
            id,
            status,
            kind,
            user_id,
            restaurant_id,
            restaurant_name,
            created_at,
            subtotal,
            tax,
            total,
            currency,
            distance_miles,
            eta_minutes,
            delivery_fee,
            driver_delivery_payout,
            platform_delivery_fee,
            restaurant_commission_rate,
            restaurant_commission_amount,
            restaurant_net_amount,
            items_json
          `
        )
        .eq("id", orderId)
        .maybeSingle();

      if (error) {
        console.error(error);
        setErr("Erreur lors du chargement de la commande.");
        setLoading(false);
        return;
      }

      if (!data) {
        setErr("Commande introuvable.");
        setLoading(false);
        return;
      }

      setOrder(data as OrderRow);
      setLoading(false);
    }

    load();
  }, [orderId]);

  if (loading) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-6">
        <p className="text-sm text-gray-600">Chargement de la commande…</p>
      </main>
    );
  }

  if (err || !order) {
    return (
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-3">
        <button
          type="button"
          onClick={() => router.push("/admin/orders")}
          className="text-xs text-blue-600 underline"
        >
          ← Retour aux commandes (admin)
        </button>
        <p className="text-sm text-red-600">
          {err ?? "Commande introuvable."}
        </p>
      </main>
    );
  }

  const currency = order.currency || "USD";
  const shortId = order.id.slice(0, 8);

  const distanceLabel =
    order.distance_miles != null
      ? `${order.distance_miles.toFixed(2)} mi`
      : "—";

  const etaLabel =
    order.eta_minutes != null ? `${Math.round(order.eta_minutes)} min` : "—";

  // 🧮 Résumé financier MMD
  const restaurantCommission = order.restaurant_commission_amount ?? 0;
  const deliveryPlatformFee = order.platform_delivery_fee ?? 0;
  const mmdTotalCommission = restaurantCommission + deliveryPlatformFee;
  const driverPayout = order.driver_delivery_payout ?? 0;
  const mmdGrossMargin = mmdTotalCommission - driverPayout;

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={() => router.push("/admin/orders")}
        className="text-xs text-blue-600 underline"
      >
        ← Retour aux commandes (admin)
      </button>

      {/* HEADER */}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold">
          Commande #{shortId} (vue admin)
        </h1>
        <p className="text-sm text-gray-600">
          Détail complet de la commande pour l&apos;administration MMD Delivery.
        </p>
        <div className="inline-flex items-center rounded-full border bg-blue-50 border-blue-200 px-3 py-1 text-xs font-medium text-blue-700 mt-2">
          Statut : {statusLabel(order.status)}
        </div>
        <p className="text-xs text-gray-500">
          Créée le : {formatDate(order.created_at)}
        </p>
      </header>

      {/* INFO GÉNÉRALES */}
      <section className="border rounded-lg p-3 bg-white text-sm space-y-1">
        <h2 className="text-sm font-semibold mb-1">Informations générales</h2>
        <p>
          <span className="font-medium">Type :</span>{" "}
          {order.kind || "—"}
        </p>
        <p>
          <span className="font-medium">Client (user_id) :</span>{" "}
          {order.user_id || "—"}
        </p>
        <p>
          <span className="font-medium">
            Restaurant (restaurant_id) :
          </span>{" "}
          {order.restaurant_id || "—"}
        </p>
        <p>
          <span className="font-medium">Nom du restaurant :</span>{" "}
          {order.restaurant_name || "—"}
        </p>
      </section>

      {/* RÉCAP COMMANDE */}
      <section className="border rounded-lg p-3 bg-white text-sm space-y-3">
        <h2 className="text-sm font-semibold mb-1">
          Récapitulatif de la commande (plats)
        </h2>

        {order.items_json && order.items_json.length > 0 ? (
          <div className="space-y-2">
            {order.items_json.map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                className="flex items-center justify-between gap-2"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.category && (
                    <p className="text-[11px] text-gray-500">
                      {item.category}
                    </p>
                  )}
                  <p className="text-[11px] text-gray-500">
                    Qté {item.quantity} —{" "}
                    {item.unit_price.toFixed(2)} {currency} / unité
                  </p>
                </div>
                <p className="text-xs font-semibold">
                  {item.line_total.toFixed(2)} {currency}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">
            Aucun détail de plats enregistré.
          </p>
        )}

        <div className="pt-2 border-t mt-2 space-y-1">
          <p>
            <span className="font-medium">Montant (plats) :</span>{" "}
            {order.subtotal != null
              ? `${order.subtotal.toFixed(2)} ${currency}`
              : "—"}
          </p>
          <p>
            <span className="font-medium">Taxes :</span>{" "}
            {order.tax != null
              ? `${order.tax.toFixed(2)} ${currency}`
              : "—"}
          </p>
          <p>
            <span className="font-medium">Total client :</span>{" "}
            {order.total != null
              ? `${order.total.toFixed(2)} ${currency}`
              : "—"}
          </p>
        </div>
      </section>

      {/* LIVRAISON */}
      <section className="border rounded-lg p-3 bg-white text-sm space-y-1">
        <h2 className="text-sm font-semibold mb-1">
          Livraison (distance / temps / frais)
        </h2>
        <p>
          <span className="font-medium">Distance estimée :</span>{" "}
          {distanceLabel}
        </p>
        <p>
          <span className="font-medium">Temps estimé :</span>{" "}
          {etaLabel}
        </p>
        <p>
          <span className="font-medium">Frais de livraison facturés :</span>{" "}
          {order.delivery_fee != null
            ? `${order.delivery_fee.toFixed(2)} ${currency}`
            : "—"}
        </p>
      </section>

      {/* 💰 COMMISSION RESTAURANT */}
      <section className="border rounded-lg p-3 bg-white text-sm space-y-1">
        <h2 className="text-sm font-semibold">
          Commission restaurant (plats)
        </h2>

        <p>
          <span className="font-medium">Taux MMD (sur plats) :</span>{" "}
          {order.restaurant_commission_rate != null
            ? `${(order.restaurant_commission_rate * 100).toFixed(2)} %`
            : "—"}
        </p>

        <p>
          <span className="font-medium">Commission MMD :</span>{" "}
          {order.restaurant_commission_amount != null
            ? `${order.restaurant_commission_amount.toFixed(2)} ${currency}`
            : "—"}
        </p>

        <p>
          <span className="font-medium">Montant net restaurant :</span>{" "}
          {order.restaurant_net_amount != null
            ? `${order.restaurant_net_amount.toFixed(2)} ${currency}`
            : "—"}
        </p>

        <p className="text-[11px] text-gray-500 mt-1">
          Calcul basé sur 15% MMD / 85% restaurant sur le montant des plats
          (ou le taux configuré si différent).
        </p>
      </section>

      {/* 💸 COMMISSION MMD & CHAUFFEUR */}
      <section className="border rounded-lg p-3 bg-white text-sm space-y-1">
        <h2 className="text-sm font-semibold">
          Commission MMD & rémunération chauffeur
        </h2>

        <p>
          <span className="font-medium">Frais de livraison (client) :</span>{" "}
          {order.delivery_fee != null
            ? `${order.delivery_fee.toFixed(2)} ${currency}`
            : "—"}
        </p>
        <p>
          <span className="font-medium">Part chauffeur :</span>{" "}
          {order.driver_delivery_payout != null
            ? `${order.driver_delivery_payout.toFixed(2)} ${currency}`
            : "—"}
        </p>
        <p>
          <span className="font-medium">Part MMD (plateforme) :</span>{" "}
          {order.platform_delivery_fee != null
            ? `${order.platform_delivery_fee.toFixed(2)} ${currency}`
            : "—"}
        </p>

        <p className="text-[11px] text-gray-500 mt-1">
          Basé sur la répartition actuelle : 80% chauffeur / 20% plateforme
          sur les frais de livraison. Ces règles pourront être ajustées
          dans le panneau admin MMD Delivery.
        </p>
      </section>

      {/* 📊 RÉSUMÉ FINANCIER MMD */}
      <section className="border rounded-lg p-3 bg-white text-sm space-y-1">
        <h2 className="text-sm font-semibold">
          Résumé financier MMD (par commande)
        </h2>

        <p>
          <span className="font-medium">Commission MMD sur plats :</span>{" "}
          {restaurantCommission
            ? `${restaurantCommission.toFixed(2)} ${currency}`
            : "—"}
        </p>
        <p>
          <span className="font-medium">
            Commission MMD sur livraison :
          </span>{" "}
          {deliveryPlatformFee
            ? `${deliveryPlatformFee.toFixed(2)} ${currency}`
            : "—"}
        </p>
        <p>
          <span className="font-medium">
            Commission totale MMD (plats + livraison) :
          </span>{" "}
          {mmdTotalCommission
            ? `${mmdTotalCommission.toFixed(2)} ${currency}`
            : "—"}
        </p>
        <p>
          <span className="font-medium">Rémunération chauffeur :</span>{" "}
          {driverPayout
            ? `${driverPayout.toFixed(2)} ${currency}`
            : "—"}
        </p>
        <p>
          <span className="font-medium">Marge brute MMD (approx.) :</span>{" "}
          {mmdTotalCommission || driverPayout
            ? `${mmdGrossMargin.toFixed(2)} ${currency}`
            : "—"}
        </p>

        <p className="text-[11px] text-gray-500 mt-1">
          Marge brute MMD ≈ (commission sur plats + commission sur
          livraison) - rémunération chauffeur. Les frais de carte,
          taxes, marketing, etc. viendront encore réduire cette marge.
        </p>
      </section>

      {/* 🕒 HISTORIQUE DE LA COMMANDE */}
      <section className="border rounded-lg p-3 bg-white text-sm space-y-1">
        <OrderTimeline orderId={order.id} />
      </section>
    </main>
  );
}
