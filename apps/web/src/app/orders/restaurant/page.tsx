"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";
import { startRingtone, stopRingtone } from "@/lib/ringtone";

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
};

type Me = {
  id: string;
  full_name: string | null;
};

const ACTIVE_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "prepared",
  "ready",
  "dispatched",
];

function restaurantStatusLabel(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "En attente (à accepter)";
    case "accepted":
      return "Acceptée (en préparation)";
    case "prepared":
      return "Préparée (en attente de pickup)";
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

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export default function RestaurantOrdersDashboardPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [activeOrders, setActiveOrders] = useState<OrderRow[]>([]);
  const [pastOrders, setPastOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const restaurantIdRef = useRef<string | null>(null);

  // ✅ anti-double load
  const loadingRef = useRef(false);

  // ✅ pour détecter arrivée d'un nouveau pending (restart sonnerie)
  const lastPendingIdsRef = useRef<Set<string>>(new Set());
  const didInitRef = useRef(false);

  // ⏱️ chrono 3 minutes pour la sonnerie
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearRingTimeout() {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
  }

  function armRingTimeout3min() {
    clearRingTimeout();
    ringTimeoutRef.current = setTimeout(() => {
      stopRingtone();
      ringTimeoutRef.current = null;
    }, 3 * 60 * 1000); // 3 minutes
  }

  async function load(opts?: { silent?: boolean }) {
    if (loadingRef.current) return;
    loadingRef.current = true;

    if (!opts?.silent) setLoading(true);
    setErr(null);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error(userError);
        setErr(userError.message);
        return;
      }

      const user = userData.user;
      if (!user) {
        setErr("Tu dois être connecté en tant que restaurant pour voir ces commandes.");
        return;
      }

      const uid = user.id;
      restaurantIdRef.current = uid;

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", uid)
        .maybeSingle();

      if (!profileError && profileRow) {
        setMe({ id: profileRow.id, full_name: profileRow.full_name ?? null });
      } else {
        setMe({ id: uid, full_name: user.email ?? null });
      }

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
          total
        `
        )
        .eq("restaurant_id", uid)
        .order("created_at", { ascending: false });

      if (ordersError) {
        console.error(ordersError);
        setErr(ordersError.message);
        return;
      }

      const allOrders = (ordersData || []) as OrderRow[];

      const active = allOrders.filter((o) => ACTIVE_STATUSES.includes(o.status));
      const past = allOrders.filter((o) => o.status === "delivered" || o.status === "canceled");

      // ✅ pending du moment
      const pendingNow = active.filter((o) => o.status === "pending");
      const nowIds = new Set(pendingNow.map((o) => o.id));

      // ✅ si plus de pending => stop immédiat + stop chrono
      if (nowIds.size === 0) {
        clearRingTimeout();
        stopRingtone();
      }

      // ✅ restart sonnerie si un nouveau pending arrive
      if (!didInitRef.current) {
        lastPendingIdsRef.current = nowIds;
        didInitRef.current = true;
      } else {
        let hasNew = false;
        for (const id of nowIds) {
          if (!lastPendingIdsRef.current.has(id)) {
            hasNew = true;
            break;
          }
        }
        lastPendingIdsRef.current = nowIds;

        if (hasNew) {
          stopRingtone();
          startRingtone();
          armRingTimeout3min();
        }
      }

      setActiveOrders(active);
      setPastOrders(past);
    } finally {
      if (!opts?.silent) setLoading(false);
      loadingRef.current = false;
    }
  }

  const pendingCount = useMemo(() => {
    return activeOrders?.filter((o) => o.status === "pending").length ?? 0;
  }, [activeOrders]);

  // 🔔 Ici on ne relance PLUS startRingtone (évite double déclenchement)
  useEffect(() => {
    if (pendingCount === 0) {
      clearRingTimeout();
      stopRingtone();
    }

    return () => {
      clearRingTimeout();
      stopRingtone();
    };
  }, [pendingCount]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Realtime: refresh auto + STOP immédiat si pending -> autre status
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      // si pas encore prêt, load une fois
      if (!restaurantIdRef.current) await load({ silent: true });

      const uid = restaurantIdRef.current;
      if (!uid) return;

      channel = supabase
        .channel(`restaurant-orders-watch-${uid}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "orders",
            filter: `restaurant_id=eq.${uid}`,
          },
          (payload: any) => {
            try {
              const oldStatus = payload?.old?.status as OrderStatus | undefined;
              const newStatus = payload?.new?.status as OrderStatus | undefined;

              // ✅ si on accepte (pending -> accepted/prepared/...)
              if (oldStatus === "pending" && newStatus && newStatus !== "pending") {
                clearRingTimeout();
                stopRingtone();
              }
            } catch {}

            void load({ silent: true });
          }
        )
        .subscribe();
    };

    void setup();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Commandes à préparer</h1>
          <p className="text-sm text-gray-600">
            Restaurant :{" "}
            <span className="font-medium">{me?.full_name || "Ton restaurant"}</span>
          </p>
          <p className="text-xs text-gray-500">
            Affiche les commandes où tu es défini comme restaurant (orders.restaurant_id = ton user_id).
          </p>
        </div>

        <button
          type="button"
          onClick={() => load()}
          className="px-3 py-1.5 rounded-lg border text-sm bg-white hover:bg-gray-50"
        >
          Rafraîchir
        </button>
      </header>

      {loading && (
        <p className="text-sm text-gray-600">Chargement des commandes restaurant…</p>
      )}

      {err && <p className="text-sm text-red-600">Erreur : {err}</p>}

      {!loading && !err && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">Commandes en cours</h2>
            <p className="text-xs text-gray-500">
              Commandes en attente, acceptées, en préparation, prêtes ou en livraison.
            </p>
          </div>

          {activeOrders.length === 0 ? (
            <p className="text-sm text-gray-600">
              Tu n&apos;as aucune commande en cours pour le moment.
            </p>
          ) : (
            <div className="space-y-3">
              {activeOrders.map((order) => {
                const shortId = order.id.slice(0, 8);
                const amount = order.total ?? order.subtotal ?? 0;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Commande #{shortId}</p>
                        <p className="text-xs text-gray-500">
                          Créée le {formatDate(order.created_at)}
                        </p>

                        {order.restaurant_name && (
                          <p className="text-xs text-gray-600">
                            Restaurant :{" "}
                            <span className="font-medium">{order.restaurant_name}</span>
                          </p>
                        )}

                        <p className="text-xs text-gray-600">
                          Montant :{" "}
                          <span className="font-semibold">
                            {amount.toFixed(2)} {order.currency || "USD"}
                          </span>
                        </p>
                      </div>

                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-amber-50 text-amber-700 border-amber-200">
                        {restaurantStatusLabel(order.status)}
                      </span>
                    </div>

                    <p className="text-xs text-gray-500">
                      Clique sur &quot;Détails&quot; pour accepter la commande, marquer la préparation
                      ou la mise à disposition pour le chauffeur.
                    </p>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
                      <Link
                        href={`/orders/${order.id}`}
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                      >
                        Détails de la commande
                      </Link>
                      <Link
                        href={`/orders/${order.id}/chat`}
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                      >
                        Ouvrir le chat
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {!loading && !err && (
        <section className="space-y-3">
          <div className="pt-4 border-t">
            <h2 className="text-lg font-semibold">Historique des commandes</h2>
            <p className="text-xs text-gray-500">Commandes livrées ou annulées pour ce restaurant.</p>
          </div>

          {pastOrders.length === 0 ? (
            <p className="text-sm text-gray-600">
              Aucun historique de commande pour l&apos;instant.
            </p>
          ) : (
            <div className="space-y-3">
              {pastOrders.map((order) => {
                const shortId = order.id.slice(0, 8);
                const amount = order.total ?? order.subtotal ?? 0;

                return (
                  <article
                    key={order.id}
                    className="border rounded-xl bg-white p-4 flex flex-col gap-2"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">Commande #{shortId}</p>
                        <p className="text-xs text-gray-500">
                          Créée le {formatDate(order.created_at)}
                        </p>
                        <p className="text-xs text-gray-600_toggle">
                          Montant :{" "}
                          <span className="font-semibold">
                            {amount.toFixed(2)} {order.currency || "USD"}
                          </span>
                        </p>
                      </div>

                      <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium bg-gray-50 text-gray-700 border-gray-200">
                        {restaurantStatusLabel(order.status)}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700">
                      <Link
                        href={`/orders/${order.id}`}
                        className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50"
                      >
                        Voir la commande
                      </Link>
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
