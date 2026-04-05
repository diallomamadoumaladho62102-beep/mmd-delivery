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
  created_at: string;
  restaurant_name: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  currency: string | null;
  items_json: OrderItem[] | null;

  // On garde ces champs pour éventuellement les utiliser ailleurs,
  // mais on NE LES AFFICHE PLUS côté restaurant :
  distance_miles: number | null;
  eta_minutes: number | null;
  delivery_fee: number | null;

  pickup_code: string | null;
  dropoff_code: string | null;

  // ✅ pour charger le driver directement
  driver_id?: string | null;
};

type DriverProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

function statusLabelForRestaurant(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "En attente (à accepter)";
    case "accepted":
      return "Acceptée (en attente de préparation)";
    case "prepared":
      return "En préparation terminée (à vérifier)";
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
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

// 👉 avatar seulement si URL complète
function getAvatarSrc(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return null;
}

export default function RestaurantOrderPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<OrderRow | null>(null);

  // ✅ driver + loader (comme demandé)
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [driverLoading, setDriverLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<false | OrderStatus>(false);

  async function loadDriver(driverId: string) {
    setDriverLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", driverId)
        .maybeSingle();

      if (error) throw error;
      setDriver((data as DriverProfile) ?? null);
    } catch {
      setDriver(null);
    } finally {
      setDriverLoading(false);
    }
  }

  async function loadOrder() {
    if (!orderId) return;
    setLoading(true);
    setErr(null);

    // 1️⃣ Charger la commande (RLS doit déjà filtrer restaurant_id = user_id)
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        status,
        created_at,
        restaurant_name,
        subtotal,
        tax,
        total,
        currency,
        items_json,
        distance_miles,
        eta_minutes,
        delivery_fee,
        pickup_code,
        dropoff_code,
        driver_id
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

    const typedOrder = data as OrderRow;
    setOrder(typedOrder);

    // 2️⃣ Charger le driver via order.driver_id (plus simple + fiable)
    if (typedOrder.driver_id) {
      await loadDriver(typedOrder.driver_id);
    } else {
      setDriver(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  // ✅ si driver_id change en realtime/refresh
  useEffect(() => {
    if (!order?.driver_id) {
      setDriver(null);
      return;
    }
    loadDriver(order.driver_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.driver_id]);

  async function updateStatus(nextStatus: OrderStatus) {
    if (!order) return;
    setSaving(nextStatus);
    setErr(null);

    const { error } = await supabase
      .from("orders")
      .update({
        status: nextStatus,
      })
      .eq("id", order.id);

    if (error) {
      console.error(error);
      setErr("Impossible de mettre à jour le statut de la commande.");
      setSaving(false);
      return;
    }

    await loadOrder();
    setSaving(false);
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6">
        <p className="text-sm text-gray-600">Chargement de la commande…</p>
      </main>
    );
  }

  if (err) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <button
          type="button"
          onClick={() => router.push("/orders/restaurant")}
          className="text-xs text-blue-600 underline"
        >
          ← Retour à la liste des commandes
        </button>
        <p className="text-sm text-red-600">Erreur : {err}</p>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <button
          type="button"
          onClick={() => router.push("/orders/restaurant")}
          className="text-xs text-blue-600 underline"
        >
          ← Retour à la liste des commandes
        </button>
        <p className="text-sm text-gray-600">Commande introuvable.</p>
      </main>
    );
  }

  const shortId = order.id.slice(0, 8);
  const currency = order.currency || "USD";

  const canAccept = order.status === "pending";
  const canPrepared = order.status === "accepted";
  const canReady = order.status === "prepared";

  const driverAvatarSrc = driver ? getAvatarSrc(driver.avatar_url) : null;

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={() => router.push("/orders/restaurant")}
        className="text-xs text-blue-600 underline"
      >
        ← Retour aux commandes du restaurant
      </button>

      {/* HEADER */}
      <header className="space-y-1">
        <h1 className="text-xl font-bold">Commande #{shortId}</h1>
        <p className="text-sm text-gray-600">
          Gestion de la commande côté restaurant (accepter, préparation, mise à
          disposition pour le chauffeur).
        </p>
        <div className="inline-flex items-center rounded-full border bg-blue-50 border-blue-200 px-3 py-1 text-xs font-medium text-blue-700 mt-2">
          Statut : {statusLabelForRestaurant(order.status)}
        </div>
        <p className="text-xs text-gray-500">
          Créée le : {formatDate(order.created_at)}
        </p>
      </header>

      {/* RESTAURANT */}
      <section className="border rounded-xl bg-white p-4 space-y-1 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">Restaurant</h2>
        <p>{order.restaurant_name || "Nom de restaurant non renseigné"}</p>
      </section>

      {/* 🚖 CHAUFFEUR ASSIGNÉ – À LA PLACE DE “LIVRAISON” */}
      <section className="border rounded-xl bg-white p-4 space-y-3 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">Chauffeur</h2>

        {!order.driver_id ? (
          <p className="text-xs text-gray-500">
            Aucun chauffeur n’est encore assigné à cette commande.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            {driverAvatarSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={driverAvatarSrc}
                alt={driver?.full_name ?? "Driver"}
                className="w-12 h-12 rounded-full border object-cover"
              />
            ) : (
              <div className="w-12 h-12 rounded-full border flex items-center justify-center bg-gray-100 text-xs font-bold">
                DR
              </div>
            )}

            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {driver?.full_name?.trim() ||
                  `Chauffeur ${order.driver_id.slice(0, 8)}`}
              </div>
              <div className="text-xs text-gray-500">
                {driverLoading ? "Chargement du profil…" : "Profil chauffeur"}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                La livraison est entièrement gérée par le chauffeur. Le
                restaurant n&apos;a pas besoin de gérer l&apos;adresse client.
              </div>
            </div>
          </div>
        )}
      </section>

      {/* CODE DE VÉRIFICATION (PICKUP SEULEMENT) */}
      <section className="border rounded-xl bg-gray-50 p-4 space-y-2 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">
          Code de vérification
        </h2>
        <p>
          <span className="font-medium">Code de ramassage (pickup) :</span>{" "}
          {order.pickup_code ?? "—"}
        </p>
        <p className="text-xs text-gray-500">
          Le restaurant doit montrer ce code au chauffeur au moment où il
          récupère la commande.
        </p>
      </section>

      {/* RÉCAP COMMANDE */}
      <section className="border rounded-xl bg-white p-4 space-y-3 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">
          Récapitulatif de la commande
        </h2>

        <div className="space-y-2">
          {order.items_json && order.items_json.length > 0 ? (
            order.items_json.map((item, idx) => (
              <div
                key={idx}
                className="flex items-start justify-between text-sm"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  {item.category ? (
                    <p className="text-xs text-gray-500">{item.category}</p>
                  ) : null}
                  <p className="text-xs text-gray-500">
                    Qté {item.quantity} —{" "}
                    {item.unit_price.toFixed(2)} {currency} / unité
                  </p>
                </div>
                <div className="text-sm font-medium">
                  {item.line_total.toFixed(2)} {currency}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-600">
              Aucun détail d&apos;article pour cette commande.
            </p>
          )}
        </div>

        <div className="border-t pt-3 space-y-1 text-sm">
          <p>
            Montant (plats) :{" "}
            <span className="font-semibold">
              {order.subtotal != null
                ? `${order.subtotal.toFixed(2)} ${currency}`
                : "—"}
            </span>
          </p>
          <p>
            Taxes :{" "}
            <span className="font-semibold">
              {order.tax != null ? `${order.tax.toFixed(2)} ${currency}` : "—"}
            </span>
          </p>
          <p>
            Total :{" "}
            <span className="font-semibold">
              {order.total != null
                ? `${order.total.toFixed(2)} ${currency}`
                : "—"}
            </span>
          </p>
        </div>
      </section>

      {/* ACTIONS RESTAURANT */}
      <section className="border rounded-xl bg-white p-4 space-y-3 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">
          Actions restaurant
        </h2>

        <p className="text-xs text-gray-500">
          Utilise ces boutons pour faire avancer la commande dans le flux normal
          : acceptation → préparation → prête pour le chauffeur.
        </p>

        <div className="flex flex-col gap-2">
          {/* Accepter */}
          <button
            type="button"
            disabled={!canAccept || !!saving}
            onClick={() => updateStatus("accepted")}
            className={`w-full rounded-md px-3 py-2 text-sm font-medium ${
              canAccept && !saving
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving === "accepted" ? "Mise à jour..." : "Accepter la commande"}
          </button>

          {/* Passer en préparation */}
          <button
            type="button"
            disabled={!canPrepared || !!saving}
            onClick={() => updateStatus("prepared")}
            className={`w-full rounded-md px-3 py-2 text-sm font-medium ${
              canPrepared && !saving
                ? "bg-amber-500 text-white hover:bg-amber-600"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving === "prepared" ? "Mise à jour..." : "Passer en préparation"}
          </button>

          {/* Marquer comme prête pour le driver */}
          <button
            type="button"
            disabled={!canReady || !!saving}
            onClick={() => updateStatus("ready")}
            className={`w-full rounded-md px-3 py-2 text-sm font-medium ${
              canReady && !saving
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-gray-300 text-gray-500 cursor-not-allowed"
            }`}
          >
            {saving === "ready"
              ? "Mise à jour..."
              : "Marquer comme prête pour le chauffeur"}
          </button>
        </div>
      </section>

      {/* CHAT */}
      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.push(`/orders/${order.id}/chat`)}
          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs font-medium"
        >
          🗨️ Ouvrir le chat de la commande
        </button>
      </div>
    </main>
  );
}
