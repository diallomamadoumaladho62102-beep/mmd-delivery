"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { DriverLiveMap } from "@/components/DriverLiveMap";

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
  dropoff_code?: string | null;
  user_id?: string | null;
  restaurant_id?: string | null;
  driver_id?: string | null;
};

type Role = "client" | "restaurant" | "driver" | "admin" | "unknown";

type DriverProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

function getAvatarSrc(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return null;
}

export default function OrderPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;

  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<Order | null>(null);
  const [role, setRole] = useState<Role>("unknown");
  const [err, setErr] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [pickupCodeInput, setPickupCodeInput] = useState("");
  const [dropoffCodeInput, setDropoffCodeInput] = useState("");
  const [verifyingPickup, setVerifyingPickup] = useState(false);
  const [verifyingDropoff, setVerifyingDropoff] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [driverId, setDriverId] = useState<string | null>(null);

  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [driverLoading, setDriverLoading] = useState(false);

  async function loadDriver(driverIdToLoad: string) {
    setDriverLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", driverIdToLoad)
        .maybeSingle();

      if (error) throw error;
      setDriver((data as DriverProfile) ?? null);
    } catch {
      setDriver(null);
    } finally {
      setDriverLoading(false);
    }
  }

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
        restaurant_id,
        driver_id
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
    setDriverId((data as any).driver_id ?? null);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData.user) {
        if (!cancelled) {
          setErr("Tu dois être connecté pour voir cette commande.");
          setLoading(false);
        }
        return;
      }

      const userId = userData.user.id;
      setCurrentUserId(userId);

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
          restaurant_id,
          driver_id
        `
        )
        .eq("id", orderId)
        .maybeSingle();

      if (orderError || !orderRow) {
        if (!cancelled) {
          console.error("orderError", orderError);
          setErr(orderError?.message ?? "Commande introuvable ou inaccessible.");
          setOrder(null);
          setLoading(false);
        }
        return;
      }

      const { data: membershipRows, error: membershipError } = await supabase
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

          if (roles.includes("admin")) detectedRole = "admin";
          else if (roles.includes("driver")) detectedRole = "driver";
          else if (roles.includes("restaurant")) detectedRole = "restaurant";
          else if (roles.includes("client")) detectedRole = "client";
        }

        if (
          orderRow.restaurant_id &&
          orderRow.restaurant_id === userId &&
          detectedRole !== "admin" &&
          detectedRole !== "driver"
        ) {
          detectedRole = "restaurant";
        }

        if (
          orderRow.user_id &&
          orderRow.user_id === userId &&
          detectedRole === "unknown"
        ) {
          detectedRole = "client";
        }

        setRole(detectedRole);
        setOrder(orderRow as Order);
        setDriverId((orderRow as any).driver_id ?? null);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  useEffect(() => {
    if (!order?.driver_id) {
      setDriver(null);
      return;
    }
    loadDriver(order.driver_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.driver_id]);

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

  const isAssignedDriver =
    !!order && !!currentUserId && order.driver_id === currentUserId;

  const canDriverAct = (isDriver && isAssignedDriver) || isAdmin;
  const canRestaurantAct = (isRestaurant || isAdmin) && order != null;

  async function callConfirmRoute(
    endpoint: "/api/orders/pickup-confirm" | "/api/orders/delivered-confirm",
    orderIdToConfirm: string
  ) {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(
        sessionError.message || "Impossible de récupérer la session."
      );
    }

    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new Error("Token de session manquant.");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: orderIdToConfirm }),
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        result?.error ||
          `Échec de la confirmation ${
            endpoint.includes("pickup") ? "pickup" : "delivery"
          }.`
      );
    }

    return result;
  }

  async function handleVerifyPickupCode() {
    if (!order) return;
    if (!pickupCodeInput.trim()) {
      setErr("Merci de saisir le code pickup.");
      return;
    }

    setVerifyingPickup(true);
    setErr(null);
    setSuccessMsg(null);

    try {
      const { data, error } = await supabase.rpc("verify_order_code", {
        p_order_id: order.id,
        p_input_code: pickupCodeInput.trim(),
        p_code_type: "pickup",
      });

      if (error) {
        console.error("verify_order_code pickup error", error);
        setErr(error.message || "Erreur serveur pendant la vérification du code.");
        return;
      }

      if (!data || (data as any).success !== true) {
        console.log("verify_order_code pickup data", data);
        const msg =
          (data as any)?.message ??
          "Code pickup incorrect ou non défini pour cette commande.";
        setErr(msg);
        return;
      }

      await callConfirmRoute("/api/orders/pickup-confirm", order.id);

      setPickupCodeInput("");
      setSuccessMsg(
        (data as any).message ??
          "Code pickup validé. Pickup confirmé avec succès."
      );
      await refetchOrder();
    } catch (e: any) {
      console.error("handleVerifyPickupCode error", e);
      setErr(
        e?.message ??
          "Erreur inattendue pendant la confirmation du pickup."
      );
    } finally {
      setVerifyingPickup(false);
    }
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

    try {
      const { data, error } = await supabase.rpc("verify_order_code", {
        p_order_id: order.id,
        p_input_code: dropoffCodeInput.trim(),
        p_code_type: "dropoff",
      });

      if (error) {
        console.error("verify_order_code dropoff error", error);
        setErr(error.message || "Erreur serveur pendant la vérification du code.");
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

      await callConfirmRoute("/api/orders/delivered-confirm", order.id);

      setDropoffCodeInput("");
      setSuccessMsg(
        (data as any).message ??
          "Code de livraison validé. Livraison confirmée avec succès."
      );
      await refetchOrder();
    } catch (e: any) {
      console.error("handleVerifyDropoffCode error", e);
      setErr(
        e?.message ??
          "Erreur inattendue pendant la confirmation de la livraison."
      );
    } finally {
      setVerifyingDropoff(false);
    }
  }

  function renderDriverActions() {
    if (!order) return null;

    if (isDriver && !isAssignedDriver) {
      return (
        <div className="border rounded-lg p-3 bg-emerald-50 text-xs text-emerald-900">
          Zone chauffeur : cette commande n’est pas assignée à ton compte.
        </div>
      );
    }

    if (!canDriverAct) return null;

    const current = order.status;

    const canDoPickup = current === "ready" && isAssignedDriver;
    const canDoDropoff = current === "dispatched" && isAssignedDriver;

    if (!canDoPickup && !canDoDropoff && !isAdmin) {
      return (
        <div className="border rounded-lg p-3 bg-emerald-50 text-xs text-emerald-900">
          Zone chauffeur : aucune action disponible maintenant.
          <div className="mt-1 text-[11px] text-emerald-800">
            (Astuce : le pickup est disponible seulement quand le restaurant met
            la commande en <b>READY</b>.)
          </div>
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

        {(current === "ready" && (isAssignedDriver || isAdmin)) && (
          <div className="space-y-2">
            <p className="text-[11px] text-emerald-900">
              Quand tu arrives au restaurant, demande le{" "}
              <span className="font-semibold">code pickup</span> (ou QR) et
              saisis-le ici pour confirmer que tu as récupéré la commande.
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

        {(current === "dispatched" && (isAssignedDriver || isAdmin)) && (
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
      setDriverId((data as any).driver_id ?? null);
    } catch (e: any) {
      console.error(e);
      setErr(e?.message ?? "Erreur inattendue lors de la mise à jour du statut.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  function renderRestaurantActions() {
    if (!canRestaurantAct || !order) return null;

    const current = order.status;
    const buttons: { label: string; next: OrderStatus }[] = [];

    if (order.driver_id && (current === "accepted" || current === "prepared")) {
      return (
        <div className="border rounded-lg p-3 bg-orange-50 space-y-2">
          <p className="text-xs font-semibold text-orange-800">Zone restaurant</p>
          <p className="text-xs text-orange-900">
            Statut actuel :{" "}
            <span className="font-semibold">
              {statusLabel[order.status] ?? order.status}
            </span>
          </p>

          <div className="text-[11px] text-orange-900">
            ⚠️ Un chauffeur est déjà assigné à cette commande, donc elle devrait
            rester en <b>READY</b> (ou avancer), pas revenir en préparation.
            <br />
            Clique sur le bouton ci-dessous pour remettre le bon statut.
          </div>

          <button
            type="button"
            disabled={updatingStatus}
            onClick={() => handleRestaurantStatusChange("ready")}
            className="px-3 py-1.5 rounded-lg bg-orange-600 text-white text-xs font-semibold disabled:opacity-50"
          >
            {updatingStatus ? "Mise à jour…" : "✅ Remettre en READY (fix)"}
          </button>
        </div>
      );
    }

    if (current === "pending") {
      buttons.push({ label: "Accepter la commande", next: "accepted" });
    } else if (current === "accepted") {
      buttons.push({ label: "Passer en préparation", next: "prepared" });
    } else if (current === "prepared") {
      buttons.push({ label: "Commande prête pour pickup", next: "ready" });
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
        <p className="text-xs font-semibold text-orange-800">Zone restaurant</p>
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
          Utilise ces boutons pour gérer la commande : accepter, préparer, puis
          déclarer la commande prête.
        </p>
      </div>
    );
  }

  function renderClientSection() {
    if (!isClient || !order) return null;

    return (
      <section className="border rounded-lg p-3 bg-sky-50 space-y-3">
        <p className="text-xs font-semibold text-sky-800">Zone client</p>

        <p className="text-xs text-sky-900">
          Quand ton chauffeur arrive, il te demandera ton{" "}
          <span className="font-semibold">code de confirmation</span>. Donne-lui
          ce code uniquement quand tu as bien reçu ta commande.
        </p>

        <div className="space-y-1">
          <p className="text-[11px] text-sky-800 font-semibold">
            Code de livraison (à montrer au chauffeur) :
          </p>
          <div className="inline-flex px-4 py-2 rounded-md bg-white border border-sky-200">
            <span className="font-mono text-base tracking-[0.35em]">
              {order.dropoff_code ?? "———"}
            </span>
          </div>
          {!order.dropoff_code && (
            <p className="text-[11px] text-sky-700 mt-1">
              Le code de livraison n’est pas encore généré pour cette commande.
            </p>
          )}
        </div>

        <p className="text-[11px] text-sky-900">
          Tu peux suivre le chauffeur en temps réel plus bas sur la carte si un
          driver est assigné.
        </p>
      </section>
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
  const driverAvatarSrc = driver ? getAvatarSrc(driver.avatar_url) : null;

  return (
    <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {isClient ? "Espace client — " : ""}
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
              <span className="font-semibold">{roleLabel[role] ?? role}</span>
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

      {renderRestaurantActions()}
      {renderDriverActions()}
      {renderClientSection()}

      <section className="grid gap-3 md:grid-cols-2">
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
              Pour le ramassage : demande au restaurant le code/QR sur son écran
              MMD Delivery.
            </p>
          )}
        </div>

        {isRestaurant && !isAdmin ? (
          <div className="border rounded-lg p-3 bg-white space-y-2 text-sm">
            <h2 className="text-sm font-semibold mb-1">Chauffeur</h2>

            {!order.driver_id ? (
              <p className="text-xs text-gray-500">
                Aucun chauffeur n’est encore assigné à cette commande.
              </p>
            ) : (
              <div className="flex items-center gap-3">
                {driverAvatarSrc ? (
                  <img
                    src={driverAvatarSrc}
                    alt={driver?.full_name ?? "Chauffeur"}
                    className="w-12 h-12 rounded-full border object-cover"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full border flex items-center justify-center bg-gray-100 text-xs font-bold">
                    {(
                      driver?.full_name?.trim()?.[0] ??
                      order.driver_id.slice(0, 1) ??
                      "D"
                    ).toUpperCase()}
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
                </div>
              </div>
            )}
          </div>
        ) : (
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
              Temps estimé : {order.eta_minutes != null ? `${order.eta_minutes} min` : "—"}
            </p>
            <p className="text-xs text-gray-600">
              Frais de livraison :{" "}
              {order.delivery_fee != null
                ? `${order.delivery_fee.toFixed(2)} ${currency}`
                : "—"}
            </p>

            {order.dropoff_code && isAdmin && (
              <p className="text-xs font-semibold text-emerald-700 mt-2">
                Code de confirmation (dropoff) : {order.dropoff_code}
              </p>
            )}

            {isDriver && (
              <p className="text-[11px] text-gray-500 mt-2">
                Pour la livraison : demande au client son code/QR uniquement quand
                il a bien reçu la commande.
              </p>
            )}
          </div>
        )}
      </section>

      {(isClient || isAdmin || isRestaurant) && (
        <section className="mt-2 border rounded-lg p-3 bg-white space-y-2">
          <h2 className="text-sm font-semibold">Suivi du chauffeur (live)</h2>
          <p className="text-xs text-gray-600">
            Position temps réel du chauffeur. La carte se met à jour quand il se
            déplace avec l&apos;app MMD Delivery.
          </p>

          <DriverLiveMap driverId={driverId} />
        </section>
      )}

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
                    <p className="text-[11px] text-gray-500">{item.category}</p>
                  )}
                  <p className="text-[11px] text-gray-500">
                    Qté {item.quantity} — {item.unit_price.toFixed(2)} {currency} / unité
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
            {(order.total ?? order.subtotal + (order.tax ?? 0)).toFixed(2)} {currency}
          </p>
        </div>
      </section>
    </main>
  );
}