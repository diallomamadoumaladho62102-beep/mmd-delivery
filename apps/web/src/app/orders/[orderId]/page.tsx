"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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

type Order = {
  id: string;
  status: OrderStatus;
  subtotal: number;
  tax: number | null;
  total: number | null;
  currency: string;
  restaurant_name?: string | null;
  created_at?: string | null;
  items_json?: OrderItem[] | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  distance_miles?: number | null;
  eta_minutes?: number | null;
  delivery_fee?: number | null;
  pickup_code?: string | null;
  dropoff_code?: string | null; // 👈 code de confirmation client
  user_id?: string | null; // 👈 créateur de la commande (client)
  restaurant_id?: string | null; // 👈 restaurant propriétaire
};

type Role = "client" | "restaurant" | "driver" | "admin" | "unknown";

export default function OrderPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [role, setRole] = useState<Role>("unknown");
  const [err, setErr] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // 🔐 états pour les codes chauffeur
  const [pickupCodeInput, setPickupCodeInput] = useState("");
  const [dropoffCodeInput, setDropoffCodeInput] = useState("");
  const [verifyingPickup, setVerifyingPickup] = useState(false);
  const [verifyingDropoff, setVerifyingDropoff] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 🔁 Recharger uniquement la commande (après vérif de code)
  async function refetchOrder() {
    if (!orderId) return;

    const { data, error } = await supabase
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
        items_json,
        pickup_address,
        dropoff_address,
        distance_miles,
        eta_minutes,
        delivery_fee,
        pickup_code,
        dropoff_code,
        user_id,
        restaurant_id
      `
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error || !data) {
      console.error("refetchOrder error", error);
      setErr(error?.message ?? "Commande introuvable ou inaccessible.");
      return;
    }

    setOrder(data as Order);
  }

  // 1) Charger la commande + le rôle de l'utilisateur
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      // utilisateur connecté
      const { data: userData, error: userError } =
        await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (!cancelled) {
          setErr("Tu dois être connecté pour voir cette commande.");
          setLoading(false);
        }
        return;
      }

      const userId = userData.user.id;

      // commande (on récupère aussi user_id et restaurant_id)
      const { data: orderRow, error: orderError } = await supabase
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
          items_json,
          pickup_address,
          dropoff_address,
          distance_miles,
          eta_minutes,
          delivery_fee,
          pickup_code,
          dropoff_code,
          user_id,
          restaurant_id
        `
        )
        .eq("id", orderId)
        .maybeSingle();

      if (orderError || !orderRow) {
        if (!cancelled) {
          console.error("orderError", orderError);
          setErr(
            orderError?.message ?? "Commande introuvable ou inaccessible."
          );
          setOrder(null);
          setLoading(false);
        }
        return;
      }

      // rôle sur cette commande (order_members = driver/admin/etc.)
      const { data: membershipRows, error: membershipError } =
        await supabase
          .from("order_members")
          .select("role")
          .eq("order_id", orderId)
          .eq("user_id", userId);

      if (!cancelled) {
        if (membershipError) {
          console.error("membershipError", membershipError);
        }

        let detectedRole: Role = "unknown";

        if (membershipRows && membershipRows.length > 0) {
          const roles = membershipRows
            .map((m) => m.role as Role)
            .filter(Boolean);

          // priorité : admin > driver > restaurant > client
          if (roles.includes("admin")) detectedRole = "admin";
          else if (roles.includes("driver")) detectedRole = "driver";
          else if (roles.includes("restaurant")) detectedRole = "restaurant";
          else if (roles.includes("client")) detectedRole = "client";
        }

        // 🔥 SÉCURITÉ : si je SUIS le restaurant_id de la commande,
        // je suis traité comme restaurant (sauf admin/driver)
        if (
          orderRow.restaurant_id &&
          orderRow.restaurant_id === userId &&
          detectedRole !== "admin" &&
          detectedRole !== "driver"
        ) {
          detectedRole = "restaurant";
        }

        // Si je suis le user_id (créateur) et aucun autre rôle détecté
        if (
          orderRow.user_id &&
          orderRow.user_id === userId &&
          detectedRole === "unknown"
        ) {
          detectedRole = "client";
        }

        setRole(detectedRole);
        setOrder(orderRow as Order);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const shortId = useMemo(() => orderId?.slice(0, 8) ?? "", [orderId]);

  const formattedDate = useMemo(() => {
    if (!order?.created_at) return null;
    try {
      const d = new Date(order.created_at);
      return d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return order.created_at;
    }
  }, [order?.created_at]);

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

  const isClient = role === "client";
  const isRestaurant = role === "restaurant";
  const isDriver = role === "driver";
  const isAdmin = role === "admin";

  const canDriverAct = (isDriver || isAdmin) && order != null;
  const canRestaurantAct = (isRestaurant || isAdmin) && order != null;

  // 2) Actions chauffeur → via CODES (pickup / dropoff)
  async function handleVerifyPickupCode() {
    if (!order) return;
    if (!pickupCodeInput.trim()) {
      setErr("Merci de saisir le code pickup.");
      return;
    }

    setVerifyingPickup(true);
    setErr(null);
    setSuccessMsg(null);

    const { data, error } = await supabase.rpc("verify_order_code", {
      p_order_id: order.id,
      p_input_code: pickupCodeInput.trim(),
      p_code_type: "pickup",
    });

    setVerifyingPickup(false);

    if (error) {
      console.error("verify_order_code pickup error", error);
      setErr("Erreur serveur pendant la vérification du code.");
      return;
    }

    // data = { success: true/false, message: '...' }
    if (!data || (data as any).success !== true) {
      console.log("verify_order_code pickup data", data);
      const msg =
        (data as any)?.message ??
        "Code pickup incorrect ou non défini pour cette commande.";
      setErr(msg);
      return;
    }

    setPickupCodeInput("");
    setSuccessMsg(
      (data as any).message ??
        "Code pickup validé. La commande passe en livraison (dispatched)."
    );
    await refetchOrder();
  }

  async function handleVerifyDropoffCode() {
    if (!order) return;
    if (!dropoffCodeInput.trim()) {
      setErr("Merci de saisir le code de livraison.");
      return;
    }

    setVerifyingDropoff(true);
    setErr(null);
    setSuccessMsg(null);

    const { data, error } = await supabase.rpc("verify_order_code", {
      p_order_id: order.id,
      p_input_code: dropoffCodeInput.trim(),
      p_code_type: "dropoff", // ou "delivery", les 2 sont gérés dans la fonction SQL
    });

    setVerifyingDropoff(false);

    if (error) {
      console.error("verify_order_code dropoff error", error);
      setErr("Erreur serveur pendant la vérification du code.");
      return;
    }

    if (!data || (data as any).success !== true) {
      console.log("verify_order_code dropoff data", data);
      const msg =
        (data as any)?.message ??
        "Code de livraison incorrect ou non défini pour cette commande.";
      setErr(msg);
      return;
    }

    setDropoffCodeInput("");
    setSuccessMsg(
      (data as any).message ??
        "Code de livraison validé. La commande passe en livrée (delivered)."
    );
    await refetchOrder();
  }

  function renderDriverActions() {
    if (!canDriverAct || !order) return null;

    const current = order.status;

    // si le statut ne demande pas de code, juste une info
    if (current !== "ready" && current !== "dispatched") {
      return (
        <div className="border rounded-lg p-3 bg-emerald-50 text-xs text-emerald-900">
          Zone chauffeur / livreur : aucune action de code requise pour le
          moment sur cette commande.
        </div>
      );
    }

    return (
      <div className="border rounded-lg p-3 bg-emerald-50 space-y-3">
        <p className="text-xs font-semibold text-emerald-800">
          Zone chauffeur / livreur
        </p>
        <p className="text-xs text-emerald-900">
          Statut actuel :{" "}
          <span className="font-semibold">
            {statusLabel[order.status] ?? order.status}
          </span>
        </p>

        {current === "ready" && (
          <div className="space-y-2">
            <p className="text-[11px] text-emerald-900">
              Quand tu arrives au restaurant, demande le{" "}
              <span className="font-semibold">code pickup</span> (ou QR) et
              saisis-le ici pour confirmer que tu as bien récupéré la
              commande.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={pickupCodeInput}
                onChange={(e) => setPickupCodeInput(e.target.value)}
                placeholder="Code pickup"
                className="flex-1 border rounded-md px-2 py-1 text-xs"
              />
              <button
                type="button"
                disabled={verifyingPickup}
                onClick={handleVerifyPickupCode}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                {verifyingPickup ? "Vérification…" : "Valider pickup"}
              </button>
            </div>
          </div>
        )}

        {current === "dispatched" && (
          <div className="space-y-2">
            <p className="text-[11px] text-emerald-900">
              À la livraison, demande au client son{" "}
              <span className="font-semibold">code de confirmation</span>{" "}
              (dropoff). Saisis-le ici pour terminer la course.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={dropoffCodeInput}
                onChange={(e) => setDropoffCodeInput(e.target.value)}
                placeholder="Code de livraison"
                className="flex-1 border rounded-md px-2 py-1 text-xs"
              />
              <button
                type="button"
                disabled={verifyingDropoff}
                onClick={handleVerifyDropoffCode}
                className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
              >
                {verifyingDropoff ? "Vérification…" : "Valider livraison"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 3) Actions restaurant → accepter / préparer / prête (inchangé)
  async function handleRestaurantStatusChange(nextStatus: OrderStatus) {
    if (!order) return;
    setUpdatingStatus(true);
    setErr(null);
    setSuccessMsg(null);

    try {
      const { data, error } = await supabase
        .from("orders")
        .update({ status: nextStatus })
        .eq("id", order.id)
        .select()
        .single();

      if (error || !data) {
        console.error("update status error (restaurant)", error);
        throw error ?? new Error("Mise à jour du statut échouée.");
      }

      setOrder(data as Order);
    } catch (e: any) {
      console.error(e);
      setErr(
        e?.message ?? "Erreur inattendue lors de la mise à jour du statut."
      );
    } finally {
      setUpdatingStatus(false);
    }
  }

  function renderRestaurantActions() {
    if (!canRestaurantAct || !order) return null;

    const current = order.status;

    const buttons: { label: string; next: OrderStatus }[] = [];

    if (current === "pending") {
      buttons.push({
        label: "Accepter la commande",
        next: "accepted",
      });
    } else if (current === "accepted") {
      buttons.push({
        label: "Passer en préparation",
        next: "prepared",
      });
    } else if (current === "prepared") {
      buttons.push({
        label: "Commande prête pour pickup",
        next: "ready",
      });
    }

    if (buttons.length === 0) {
      return (
        <div className="border rounded-lg p-3 bg-orange-50 text-xs text-orange-700">
          Aucune action requise pour le moment pour le restaurant sur cette
          commande.
        </div>
      );
    }

    return (
      <div className="border rounded-lg p-3 bg-orange-50 space-y-2">
        <p className="text-xs font-semibold text-orange-800">
          Zone restaurant
        </p>
        <p className="text-xs text-orange-900">
          Statut actuel :{" "}
          <span className="font-semibold">
            {statusLabel[order.status] ?? order.status}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {buttons.map((btn) => (
            <button
              key={btn.next}
              type="button"
              disabled={updatingStatus}
              onClick={() => handleRestaurantStatusChange(btn.next)}
              className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {updatingStatus ? "Mise à jour…" : btn.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-orange-900">
          Utilise ces boutons pour gérer la commande depuis ta cuisine :
          accepter, préparer, puis déclarer la commande prête pour le chauffeur.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold">Commande</h1>
        <p className="text-sm text-gray-600 mt-2">
          Chargement des informations de la commande…
        </p>
      </main>
    );
  }

  if (err || !order) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold">Commande</h1>
        <p className="text-sm text-red-600 mt-2">
          {err ?? "Commande introuvable."}
        </p>
        <Link
          href="/orders"
          className="inline-flex mt-4 text-sm text-emerald-700 underline"
        >
          ← Retour à mes commandes
        </Link>
      </main>
    );
  }

  const items = order.items_json ?? [];
  const currency = order.currency || "USD";

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      {/* HEADER */}
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Commande #{shortId || order.id}
          </h1>
          <p className="text-xs text-gray-600">
            Statut :{" "}
            <span className="font-semibold">
              {statusLabel[order.status] ?? order.status}
            </span>
          </p>
          {formattedDate && (
            <p className="text-xs text-gray-500">Créée le : {formattedDate}</p>
          )}
          {role !== "unknown" && (
            <p className="text-xs text-gray-500 mt-1">
              Ton rôle :{" "}
              <span className="font-semibold">
                {roleLabel[role] ?? role}
              </span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 items-start sm:items-end">
          <Link
            href={`/orders/${order.id}/chat`}
            className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-semibold hover:bg-gray-50"
          >
            🗨️ Ouvrir le chat de la commande
          </Link>

          {/* lien de retour adapté au rôle */}
          {isDriver && (
            <Link
              href="/orders/driver"
              className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs hover:bg-gray-50"
            >
              ← Retour au tableau de bord chauffeur
            </Link>
          )}
          {isRestaurant && (
            <Link
              href="/orders/restaurant"
              className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs hover:bg-gray-50"
            >
              ← Retour aux commandes du restaurant
            </Link>
          )}
          {isClient && (
            <Link
              href="/orders"
              className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs hover:bg-gray-50"
            >
              ← Retour à mes commandes
            </Link>
          )}
          {isAdmin && (
            <Link
              href="/admin/orders"
              className="inline-flex items-center px-3 py-1.5 rounded-lg border text-xs hover:bg-gray-50"
            >
              ← Retour aux commandes (admin)
            </Link>
          )}
        </div>
      </header>

      {/* messages globaux */}
      {err && (
        <div className="border rounded-lg p-3 bg-red-50 text-xs text-red-700">
          {err}
        </div>
      )}
      {successMsg && (
        <div className="border rounded-lg p-3 bg-emerald-50 text-xs text-emerald-800">
          {successMsg}
        </div>
      )}

      {/* ZONE RESTAURANT */}
      {renderRestaurantActions()}

      {/* ZONE CHAUFFEUR (avec codes) */}
      {renderDriverActions()}

      {/* INFO ADRESSES / LIVRAISON – filtrées par rôle */}
      <section className="grid gap-3 md:grid-cols-2">
        {/* Carte Restaurant */}
        <div className="border rounded-lg p-3 bg-white space-y-1 text-sm">
          <h2 className="text-sm font-semibold mb-1">Restaurant</h2>
          <p className="text-sm font-medium">
            {order.restaurant_name ?? "Restaurant inconnu"}
          </p>

          {(isRestaurant || isDriver || isAdmin) && order.pickup_address && (
            <p className="text-xs text-gray-600">
              Adresse de récupération : {order.pickup_address}
            </p>
          )}

          {isClient && !order.pickup_address && (
            <p className="text-xs text-gray-500">
              L&apos;adresse du restaurant sera visible au chauffeur.
            </p>
          )}

          {order.pickup_code && (isRestaurant || isAdmin) && (
            <p className="text-xs font-semibold text-emerald-700 mt-1">
              Code de retrait à donner au chauffeur : {order.pickup_code}
            </p>
          )}

          {isDriver && (
            <p className="text-[11px] text-gray-500 mt-1">
              Pour le ramassage : demande au restaurant de te montrer le code
              ou le QR sur son écran MMD Delivery.
            </p>
          )}
        </div>

        {/* Carte Livraison */}
        <div className="border rounded-lg p-3 bg-white space-y-1 text-sm">
          <h2 className="text-sm font-semibold mb-1">Livraison</h2>

          {(isClient || isDriver || isAdmin) && order.dropoff_address && (
            <p className="text-xs text-gray-600">
              Adresse de livraison : {order.dropoff_address}
            </p>
          )}

          {isRestaurant && order.dropoff_address && (
            <p className="text-xs text-gray-500">
              Adresse client : gérée par le chauffeur.
            </p>
          )}

          <p className="text-xs text-gray-600">
            Distance estimée :{" "}
            {order.distance_miles != null
              ? `${order.distance_miles.toFixed(2)} mi`
              : "—"}
          </p>
          <p className="text-xs text-gray-600">
            Temps estimé :{" "}
            {order.eta_minutes != null ? `${order.eta_minutes} min` : "—"}
          </p>
          <p className="text-xs text-gray-600">
            Frais de livraison :{" "}
            {order.delivery_fee != null
              ? `${order.delivery_fee.toFixed(2)} ${currency}`
              : "—"}
          </p>

          {order.dropoff_code && (isClient || isAdmin) && (
            <p className="text-xs font-semibold text-emerald-700 mt-2">
              Code de confirmation à donner au chauffeur à la livraison :{" "}
              {order.dropoff_code}
            </p>
          )}

          {isDriver && (
            <p className="text-[11px] text-gray-500 mt-2">
              Pour la livraison : demande au client de te montrer son code ou
              son QR uniquement quand il a bien reçu la commande.
            </p>
          )}
        </div>
      </section>

      {/* RÉCAP COMMANDE */}
      <section className="border rounded-lg p-3 bg-white space-y-2">
        <h2 className="text-sm font-semibold mb-1">
          Récapitulatif de la commande
        </h2>

        {items.length === 0 ? (
          <p className="text-xs text-gray-500">
            Aucun détail de plats enregistré pour cette commande.
          </p>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div
                key={`${item.name}-${idx}`}
                className="flex items-center justify-between gap-2 text-sm"
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
        )}

        <div className="pt-2 border-t mt-2 space-y-1 text-sm">
          <p>
            <span className="font-medium">Montant (plats) :</span>{" "}
            {order.subtotal.toFixed(2)} {currency}
          </p>
          <p>
            <span className="font-medium">Taxes :</span>{" "}
            {(order.tax ?? 0).toFixed(2)} {currency}
          </p>
          <p>
            <span className="font-medium">Total :</span>{" "}
            {(order.total ?? order.subtotal + (order.tax ?? 0)).toFixed(2)}{" "}
            {currency}
          </p>
        </div>
      </section>
    </main>
  );
}
