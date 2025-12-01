"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  kind: string | null;
  restaurant_name: string | null;
  created_at: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  items_json: OrderItem[] | null;
};

function statusLabel(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "En attente";
    case "accepted":
      return "Acceptée";
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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function RestaurantOrderPage() {
  const params = useParams<{ orderId: string }>();
  const router = useRouter();
  const orderId = params.orderId;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // 🔁 Charger la commande
  useEffect(() => {
    if (!orderId) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          status,
          kind,
          restaurant_name,
          created_at,
          subtotal,
          tax,
          total,
          currency,
          items_json
        `
        )
        .eq("id", orderId)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.error("Erreur chargement commande restaurant:", error);
        setErr(`Erreur de chargement : ${error.message}`);
        setOrder(null);
      } else if (!data) {
        setErr("Commande introuvable.");
        setOrder(null);
      } else {
        setOrder(data as OrderRow);
      }

      setLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // 🔁 Mise à jour du statut
  async function updateStatus(newStatus: OrderStatus) {
    if (!orderId || !order) return;

    setErr(null);
    setActionLoading(true);

    const { data, error } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId)
      .select("id, status")
      .maybeSingle();

    if (error) {
      console.error("Erreur update statut commande (restaurant):", error);
      setErr(
        `Erreur : Impossible de mettre à jour le statut de la commande. (${error.message})`
      );
      setActionLoading(false);
      return;
    }

    // ✅ on met à jour le state local
    setOrder((prev) =>
      prev ? { ...prev, status: (data?.status as OrderStatus) ?? newStatus } : prev
    );
    setActionLoading(false);
  }

  // Boutons en fonction du statut
  function renderActions() {
    if (!order) return null;

    const s = order.status;

    const buttons: { label: string; next: OrderStatus }[] = [];

    if (s === "pending") {
      buttons.push({ label: "Accepter la commande", next: "accepted" });
    }

    if (s === "accepted") {
      buttons.push({ label: "Passer en préparation", next: "prepared" });
    }

    if (s === "prepared") {
      buttons.push({ label: "Marquer comme prête", next: "ready" });
    }

    if (s === "ready") {
      // Ici normalement c'est le driver qui prend la main, mais on laisse un bouton admin/restaurant si besoin
      buttons.push({ label: "Marquer en livraison", next: "dispatched" });
    }

    if (s === "dispatched") {
      buttons.push({ label: "Marquer comme livrée", next: "delivered" });
    }

    if (buttons.length === 0) {
      return (
        <p className="text-xs text-slate-500">
          Aucun changement de statut possible depuis l&apos;état actuel.
        </p>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <button
            key={b.next}
            type="button"
            disabled={actionLoading}
            onClick={() => updateStatus(b.next)}
            className="inline-flex items-center rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          >
            {actionLoading ? "En cours…" : b.label}
          </button>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6">
        <button
          type="button"
          onClick={() => router.push("/restaurant/orders")}
          className="text-xs text-blue-600 underline mb-3"
        >
          ← Retour à la liste des commandes
        </button>
        <p className="text-sm text-slate-600">Chargement de la commande…</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <button
          type="button"
          onClick={() => router.push("/restaurant/orders")}
          className="text-xs text-blue-600 underline"
        >
          ← Retour à la liste des commandes
        </button>
        <p className="text-sm text-red-600">
          {err ?? "Commande introuvable."}
        </p>
      </main>
    );
  }

  const currency = order.currency || "USD";

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={() => router.push("/restaurant/orders")}
        className="text-xs text-blue-600 underline"
      >
        ← Retour à la liste des commandes
      </button>

      <header className="space-y-1">
        <h1 className="text-2xl font-bold">Commande restaurant</h1>
        <p className="text-sm text-slate-600">
          {order.restaurant_name
            ? `Restaurant : ${order.restaurant_name}`
            : "Commande reçue via MMD Delivery"}
        </p>
        <div className="inline-flex items-center rounded-full border bg-blue-50 border-blue-200 px-3 py-1 text-xs font-medium text-blue-700 mt-2">
          Statut : {statusLabel(order.status)}
        </div>
        <p className="text-xs text-slate-500">
          Créée le : {formatDate(order.created_at)}
        </p>
      </header>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {err}
        </div>
      )}

      <section className="border rounded-lg p-3 bg-white text-sm space-y-2">
        <h2 className="text-sm font-semibold mb-1">
          Actions sur la commande
        </h2>
        {renderActions()}
      </section>

      <section className="border rounded-lg p-3 bg-white text-sm space-y-3">
        <h2 className="text-sm font-semibold mb-1">
          Détail des plats
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
                    <p className="text-[11px] text-slate-500">
                      {item.category}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-500">
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
          <p className="text-xs text-slate-500">
            Aucun détail de plats enregistré.
          </p>
        )}

        <div className="pt-2 border-t mt-2 space-y-1">
          <p>
            <span className="font-medium">Sous-total :</span>{" "}
            {order.subtotal != null
              ? `${order.subtotal.toFixed(2)} ${currency}`
              : "—"}
          </p>
          <p>
            <span className="font-medium">Taxes :</span>{" "}
            {order.tax != null ? `${order.tax.toFixed(2)} ${currency}` : "—"}
          </p>
          <p>
            <span className="font-medium">Total :</span>{" "}
            {order.total != null
              ? `${order.total.toFixed(2)} ${currency}`
              : "—"}
          </p>
        </div>
      </section>
    </main>
  );
}
