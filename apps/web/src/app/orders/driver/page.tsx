"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";
import { computeDriverPay } from "@/lib/deliveryPricing";

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
  restaurant_name: string | null;
  currency: string | null;
  subtotal: number | null;
  total: number | null;
  distance_miles?: number | null;
  eta_minutes?: number | null;
  delivery_fee?: number | null; // 👈 IMPORTANT : prix livraison pour calcul 80%
};

type Me = {
  id: string;
  full_name: string | null;
};

type MemberRow = {
  order_id: string;
  user_id: string;
  role: string;
};

type ClientProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
];

function driverStatusLabel(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "En attente (envoi au restaurant)";
    case "accepted":
      return "Acceptée (chez le restaurant)";
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

// 👉 n’utilise l’avatar que si c’est une URL complète (http/https)
function getAvatarSrc(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return null;
}

export default function DriverOrdersDashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [available, setAvailable] = useState<OrderRow[]>([]);
  const [mine, setMine] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [clientByOrder, setClientByOrder] = useState<
    Record<string, ClientProfile | null>
  >({});

  async function load() {
    setLoading(true);
    setErr(null);

    // 1) utilisateur connecté
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError) {
      console.error(userError);
      setErr(userError.message);
      setLoading(false);
      return;
    }

    const user = userData.user;
    if (!user) {
      setErr(
        "Tu dois te connecter en tant que chauffeur pour voir ce tableau de bord."
      );
      setLoading(false);
      return;
    }

    const uid = user.id;

    // 2) profil (nom)
    const { data: profileRow, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("id", uid)
      .maybeSingle();

    if (!profileError && profileRow) {
      setMe({
        id: profileRow.id,
        full_name: profileRow.full_name ?? null,
      });
    } else {
      setMe({ id: uid, full_name: user.email ?? null });
    }

    // 3) Toutes les commandes actives
    const { data: ordersData, error: ordersError } = await supabase
      .from("orders")
      .select(
        `
        id,
        status,
        created_at,
        restaurant_name,
        currency,
        subtotal,
        total,
        distance_miles,
        eta_minutes,
        delivery_fee
      `
      )
      .in("status", ACTIVE_STATUSES)
      .order("created_at", { ascending: false });

    if (ordersError) {
      console.error(ordersError);
      setErr(ordersError.message);
      setLoading(false);
      return;
    }

    const allOrders = (ordersData || []) as OrderRow[];
    const orderIds = allOrders.map((o) => o.id);

    if (orderIds.length === 0) {
      setAvailable([]);
      setMine([]);
      setClientByOrder({});
      setLoading(false);
      return;
    }

    // 4) Membres des commandes
    const { data: membersData, error: membersError } = await supabase
      .from("order_members")
      .select("order_id, user_id, role")
      .in("order_id", orderIds);

    if (membersError) {
      console.error(membersError);
      setErr(membersError.message);
      setLoading(false);
      return;
    }

    const members = (membersData || []) as MemberRow[];

    // commandes où JE suis driver (non livrées / non annulées)
    const mineOrders = allOrders.filter((o) =>
      members.some(
        (m) =>
          m.order_id === o.id &&
          m.role === "driver" &&
          m.user_id === uid &&
          o.status !== "delivered" &&
          o.status !== "canceled"
      )
    );

    // commandes actives sans driver assigné
    const availableOrders = allOrders.filter(
      (o) =>
        o.status !== "delivered" &&
        o.status !== "canceled" &&
        !members.some((m) => m.order_id === o.id && m.role === "driver")
    );

    setMine(mineOrders);
    setAvailable(availableOrders);

    // 5) Profils des clients (nom + photo)
    const clientMembers = members.filter((m) => m.role === "client");
    const clientIds = Array.from(new Set(clientMembers.map((m) => m.user_id)));

    if (clientIds.length === 0) {
      setClientByOrder({});
    } else {
      const { data: clientProfilesData, error: clientProfilesError } =
        await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", clientIds);

      if (clientProfilesError || !clientProfilesData) {
        console.error(clientProfilesError);
        setClientByOrder({});
      } else {
        const profilesMap = new Map<string, ClientProfile>();
        for (const p of clientProfilesData) {
          profilesMap.set(p.id, {
            id: p.id,
            full_name: p.full_name ?? null,
            avatar_url: p.avatar_url ?? null,
          });
        }

        const byOrder: Record<string, ClientProfile | null> = {};
        for (const m of clientMembers) {
          byOrder[m.order_id] = profilesMap.get(m.user_id) ?? null;
        }

        setClientByOrder(byOrder);
      }
    }

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

  function formatDistance(order: OrderRow): string {
    if (typeof order.distance_miles === "number") {
      return `${order.distance_miles.toFixed(1)} mi`;
    }
    return "—";
  }

  function formatEta(order: OrderRow): string {
    if (typeof order.eta_minutes === "number") {
      return `${order.eta_minutes} min`;
    }
    return "—";
  }

  // 👉 Unifiée : part chauffeur = 80% du delivery_fee
  function formatDriverShare(order: OrderRow): string {
    if (order.delivery_fee == null) return "—";
    const driverPay = computeDriverPay(order.delivery_fee);
    const cur = order.currency || "USD";
    return `${driverPay.toFixed(2)} ${cur}`;
  }

  async function acceptOrder(orderId: string) {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      alert("Tu dois être connecté pour accepter une course.");
      return;
    }

    const { error } = await supabase.rpc("join_order", {
      p_order_id: orderId,
      p_role: "driver",
    });

    if (error) {
      alert(error.message);
      return;
    }

    await load();
  }

  async function rejectOrder(orderId: string) {
    const ok = window.confirm(
      "Tu ne veux pas effectuer cette course ? Elle restera disponible pour d'autres chauffeurs."
    );
    if (!ok) return;
    alert("Course refusée. Tu peux en choisir une autre.");
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tableau de bord chauffeur</h1>
          <p className="text-sm text-gray-600">
            Connecté en tant que{" "}
            <span className="font-medium">
              {me?.full_name || "Ton compte chauffeur"}
            </span>
            .
          </p>
          <p className="text-xs text-gray-500">
            Liste des courses disponibles et de tes livraisons en cours.
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
          Chargement des courses en cours…
        </p>
      )}

      {err && <p className="text-sm text-red-600">Erreur : {err}</p>}

      {/* COURSES À ACCEPTER */}
      {!loading && !err && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Courses à accepter</h2>
            <p className="text-xs text-gray-500">
              Commandes prêtes ou en cours sans driver assigné.
            </p>
          </div>

          {available.length === 0 ? (
            <p className="text-sm text-gray-600">
              Aucune course disponible pour le moment.
            </p>
          ) : (
            <div className="space-y-3">
              {available.map((order) => {
                const shortId = order.id.slice(0, 8);
                const client = clientByOrder[order.id] ?? null;
                const avatarSrc = client
                  ? getAvatarSrc(client.avatar_url)
                  : null;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                  >
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

                        {client && (
                          <div className="mt-2 flex items-center gap-2">
                            {avatarSrc ? (
                              <img
                                src={avatarSrc}
                                alt={client.full_name ?? "Client"}
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold">
                                {(client.full_name || "C")
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            <span className="text-xs text-gray-700">
                              <span className="text-[11px] text-gray-500 mr-1">
                                Client :
                              </span>
                              <span className="font-medium">
                                {client.full_name ?? "Client MMD"}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>

                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                        {driverStatusLabel(order.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
                        <p>
                          <span className="text-gray-500 mr-1">Distance :</span>
                          <span className="font-medium">
                            {formatDistance(order)}
                          </span>
                        </p>
                        <p>
                          <span className="text-gray-500 mr-1">Temps :</span>
                          <span className="font-medium">
                            {formatEta(order)}
                          </span>
                        </p>
                        <p>
                          <span className="text-gray-500 mr-1">
                            Ta part (estimée) :
                          </span>
                          <span className="font-semibold">
                            {formatDriverShare(order)}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={() => acceptOrder(order.id)}
                          className="px-3 py-1.5 rounded-lg bg-black text-white text-xs font-semibold hover:bg-gray-900"
                        >
                          Accepter la course
                        </button>

                        <button
                          type="button"
                          onClick={() => rejectOrder(order.id)}
                          className="px-3 py-1.5 rounded-lg border border-red-500 text-red-600 bg-white hover:bg-red-50 text-xs font-semibold"
                        >
                          Refuser la course
                        </button>

                        <Link
                          href={`/orders/${order.id}/driver`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Détails de la course
                        </Link>

                        <Link
                          href={`/orders/${order.id}/chat`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Ouvrir le chat
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* MES LIVRAISONS EN COURS */}
      {!loading && !err && (
        <section className="space-y-3">
          <div className="pt-4 border-t">
            <h2 className="text-lg font-semibold">Mes livraisons en cours</h2>
            <p className="text-xs text-gray-500">
              Courses où tu es déjà assigné en tant que driver.
            </p>
          </div>

          {mine.length === 0 ? (
            <p className="text-sm text-gray-600">
              Tu n&apos;as aucune livraison active pour le moment.
            </p>
          ) : (
            <div className="space-y-3">
              {mine.map((order) => {
                const shortId = order.id.slice(0, 8);
                const client = clientByOrder[order.id] ?? null;
                const avatarSrc = client
                  ? getAvatarSrc(client.avatar_url)
                  : null;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                  >
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

                        {client && (
                          <div className="mt-2 flex items-center gap-2">
                            {avatarSrc ? (
                              <img
                                src={avatarSrc}
                                alt={client.full_name ?? "Client"}
                                className="h-8 w-8 rounded-full object-cover"
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold">
                                {(client.full_name || "C")
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                            <span className="text-xs text-gray-700">
                              <span className="text-[11px] text-gray-500 mr-1">
                                Client :
                              </span>
                              <span className="font-medium">
                                {client.full_name ?? "Client MMD"}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>

                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-blue-50 text-blue-700 border-blue-200">
                        {driverStatusLabel(order.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-xs text-gray-700">
                      <p>
                        <span className="text-gray-500 mr-1">Distance :</span>
                        <span className="font-medium">
                          {formatDistance(order)}
                        </span>
                      </p>
                      <p>
                        <span className="text-gray-500 mr-1">Temps :</span>
                        <span className="font-medium">
                          {formatEta(order)}
                        </span>
                      </p>
                      <p>
                        <span className="text-gray-500 mr-1">
                          Ta part (estimée) :
                        </span>
                        <span className="font-semibold">
                          {formatDriverShare(order)}
                        </span>
                      </p>
                    </div>

                    <p className="text-xs text-gray-500">
                      Retrouve l&apos;adresse de retrait, l&apos;adresse de
                      dépôt et les instructions du client dans la page de la
                      course.
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-700">
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Link
                          href={`/orders/${order.id}/driver`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Voir la course
                        </Link>

                        <Link
                          href={`/orders/${order.id}/chat`}
                          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                        >
                          Ouvrir le chat
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
