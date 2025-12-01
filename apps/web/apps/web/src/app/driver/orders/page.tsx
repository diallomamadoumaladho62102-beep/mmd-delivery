"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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
  unit_price?: number;
  line_total?: number;
};

type OrderListItem = {
  id: string;
  status: OrderStatus;
  subtotal: number;
  currency: string;
  created_at: string;
  items_json?: OrderItem[] | null;
  restaurant_name?: string | null;
};

type Profile = {
  id: string;
  role: string | null;
  full_name: string | null;
};

function to2(n: number | string | null | undefined) {
  if (n === null || n === undefined) return "0.00";
  const num = typeof n === "number" ? n : parseFloat(String(n));
  if (Number.isNaN(num)) return "0.00";
  return num.toFixed(2);
}

function statusLabel(s: OrderStatus) {
  switch (s) {
    case "pending":
      return "En attente restaurant";
    case "accepted":
      return "Acceptée par le restaurant";
    case "prepared":
      return "En préparation";
    case "ready":
      return "Prête au restaurant";
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

// 🔄 Action principale pour le CHAUFFEUR selon le statut
function mainActionForDriver(
  s: OrderStatus
): { label: string; next: OrderStatus } | null {
  switch (s) {
    case "accepted":
    case "prepared":
    case "ready":
      return {
        label: "J’ai récupéré la commande",
        next: "dispatched",
      };
    case "dispatched":
      return {
        label: "Commande livrée",
        next: "delivered",
      };
    default:
      return null;
  }
}

export default function DriverOrdersPage() {
  const router = useRouter();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  const [err, setErr] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // 🔐 Charger le profil du user connecté
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoadingProfile(true);
      setErr(null);

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (userErr || !user) {
        setProfile(null);
        setLoadingProfile(false);
        setErr("Tu dois être connecté pour voir tes courses (chauffeur).");
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id, role, full_name")
        .eq("id", user.id)
        .maybeSingle();

      if (error || !data) {
        setProfile(null);
        setLoadingProfile(false);
        setErr("Profil introuvable.");
        return;
      }

      setProfile(data as Profile);
      setLoadingProfile(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // 📦 Charger les commandes où je suis DRIVER (order_members.role = 'driver')
  useEffect(() => {
    if (!profile?.id || profile.role !== "driver") {
      setOrders([]);
      setLoadingOrders(false);
      return;
    }

    let cancelled = false;

    async function loadOrders() {
      setLoadingOrders(true);
      setErr(null);

      // 1) trouver les order_id où je suis driver
      const { data: mems, error: memErr } = await supabase
        .from("order_members")
        .select("order_id")
        .eq("user_id", profile.id)
        .eq("role", "driver");

      if (cancelled) return;

      if (memErr) {
        setErr(memErr.message);
        setOrders([]);
        setLoadingOrders(false);
        return;
      }

      const orderIds = (mems || []).map((m: any) => m.order_id);

      if (orderIds.length === 0) {
        setOrders([]);
        setLoadingOrders(false);
        return;
      }

      // 2) récupérer les commandes correspondantes
      const { data, error } = await supabase
        .from("orders")
        .select(
          "id,status,subtotal,currency,created_at,items_json,restaurant_name"
        )
        .in("id", orderIds)
        .in("status", ["accepted", "prepared", "ready", "dispatched"]) // commandes en cours côté driver
        .order("created_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        setErr(error.message);
        setOrders([]);
        setLoadingOrders(false);
        return;
      }

      setOrders((data || []) as OrderListItem[]);
      setLoadingOrders(false);
    }

    loadOrders();

    // pas de realtime ici pour l’instant
    return () => {
      cancelled = true;
    };
  }, [profile?.id, profile?.role]);

  // 🔁 Mettre à jour le statut (gros bouton driver)
  const updateStatus = async (orderId: string, next: OrderStatus) => {
    setUpdatingId(orderId);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: next })
        .eq("id", orderId);

      if (error) {
        alert(error.message);
        setUpdatingId(null);
        return;
      }

      // On recharge la page (simple)
      router.refresh();
      setUpdatingId(null);
    } catch (e: any) {
      alert(e?.message ?? "Erreur statut");
      setUpdatingId(null);
    }
  };

  // 🧭 États de chargement / erreurs / non autorisé
  if (loadingProfile) {
    return (
      <div className="max-w-4xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">Courses chauffeur</h1>
        <p>Chargement du profil…</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow p-6 space-y-4">
          <h1 className="text-xl font-semibold text-center">
            Courses chauffeur
          </h1>
          <p className="text-sm text-gray-600 text-center">
            Tu dois être connecté pour voir tes courses.
          </p>
          <button
            onClick={() => router.push("/signup")}
            className="w-full px-3 py-2 rounded bg-black text-white text-sm"
          >
            Aller vers l’inscription / connexion
          </button>
        </div>
      </div>
    );
  }

  if (profile.role !== "driver") {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow p-6 space-y-4">
          <h1 className="text-xl font-semibold text-center">
            Courses chauffeur
          </h1>
          <p className="text-sm text-gray-600 text-center">
            Cet écran est réservé aux comptes{" "}
            <span className="font-mono">driver</span>.
          </p>
          <p className="text-xs text-gray-500 text-center">
            Compte actuel : {profile.full_name || profile.id} — rôle :{" "}
            <span className="font-mono">{profile.role}</span>
          </p>
        </div>
      </div>
    );
  }

  // ✅ Vue principale chauffeur
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Courses à livrer</h1>
            <p className="text-sm text-gray-600">
              Chauffeur :{" "}
              <span className="font-mono">
                {profile.full_name || profile.id}
              </span>
            </p>
            <p className="text-xs text-gray-500">
              Filtre : commandes où tu es driver, avec un restaurant qui a déjà
              accepté (en préparation, prête ou en livraison).
            </p>
          </div>
          <button
            onClick={() => router.refresh()}
            className="px-3 py-1.5 rounded-xl border text-sm hover:bg-gray-50"
          >
            Rafraîchir
          </button>
        </div>

        {err && (
          <div className="border border-red-300 bg-red-50 text-red-800 p-2 rounded text-sm">
            {err}
          </div>
        )}

        {loadingOrders ? (
          <div className="mt-4 text-sm text-gray-600">
            Chargement des courses…
          </div>
        ) : orders.length === 0 ? (
          <div className="mt-4 p-4 rounded-2xl border bg-white text-sm text-gray-600">
            Aucune course en cours pour le moment.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {orders.map((o) => {
              const items: OrderItem[] =
                ((o.items_json as any) || []) as OrderItem[];
              const firstItems = items.slice(0, 4);
              const extra =
                items.length > firstItems.length
                  ? items.length - firstItems.length
                  : 0;

              const mainAction = mainActionForDriver(o.status);

              return (
                <div
                  key={o.id}
                  className="bg-white rounded-2xl border p-4 flex flex-col gap-2 shadow-sm"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-xs text-gray-500">
                        Course / commande
                      </div>
                      <div className="font-mono text-sm">
                        #{o.id.substring(0, 8)}
                      </div>
                      {o.restaurant_name && (
                        <div className="text-xs text-gray-500 mt-1">
                          Restaurant :{" "}
                          <span className="font-mono">
                            {o.restaurant_name}
                          </span>
                        </div>
                      )}
                      <div className="text-xs text-gray-500 mt-1">
                        {o.created_at
                          ? new Date(o.created_at).toLocaleString()
                          : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs border">
                        <span className="h-2 w-2 rounded-full bg-emerald-400" />
                        <span>{statusLabel(o.status)}</span>
                      </div>
                      <div className="mt-2 text-sm font-semibold">
                        {to2(o.subtotal)} {o.currency}
                      </div>
                    </div>
                  </div>

                  {/* Liste rapide des items */}
                  {items.length > 0 && (
                    <div className="mt-2 text-sm">
                      {firstItems.map((it, idx) => (
                        <div
                          key={idx}
                          className="flex justify-between text-xs text-gray-700"
                        >
                          <div>
                            <span className="font-medium">{it.name}</span>{" "}
                            <span className="text-gray-500">
                              · Qté {it.quantity}
                              {it.category ? ` · ${it.category}` : ""}
                            </span>
                          </div>
                          {(it.line_total || it.unit_price) && (
                            <span>
                              $
                              {to2(
                                it.line_total ??
                                  (it.unit_price || 0) * (it.quantity || 0)
                              )}
                            </span>
                          )}
                        </div>
                      ))}
                      {extra > 0 && (
                        <div className="text-[11px] text-gray-500 mt-1">
                          + {extra} article(s) de plus…
                        </div>
                      )}
                    </div>
                  )}

                  {/* Actions chauffeur */}
                  <div className="mt-3 flex flex-wrap gap-2 items-center">
                    {mainAction && (
                      <button
                        onClick={() => updateStatus(o.id, mainAction.next)}
                        disabled={updatingId === o.id}
                        className="px-4 py-2 rounded-2xl text-sm font-semibold bg-black text-white disabled:opacity-60"
                      >
                        {updatingId === o.id
                          ? "Mise à jour…"
                          : mainAction.label}
                      </button>
                    )}

                    <button
                      onClick={() => router.push(`/orders/${o.id}`)}
                      className="px-3 py-1.5 rounded-xl border text-xs hover:bg-gray-50"
                    >
                      Voir détail commande
                    </button>
                    <button
                      onClick={() => router.push(`/orders/${o.id}/chat`)}
                      className="px-3 py-1.5 rounded-xl border text-xs hover:bg-gray-50"
                    >
                      Ouvrir le chat
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
