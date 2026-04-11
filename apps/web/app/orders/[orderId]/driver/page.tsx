"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
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
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  currency: string | null;
  delivery_fee: number | null;
};

type MemberRow = {
  role: string;
};

function driverStatusLabel(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "En attente (restaurant)";
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

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const ORDER_SELECT = `
  id,
  status,
  created_at,
  pickup_address,
  dropoff_address,
  distance_miles,
  eta_minutes,
  currency,
  delivery_fee
`;

export default function DriverOrderPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"pickup" | "dropoff" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadOrder = useCallback(async () => {
    if (!orderId) return;

    setLoading(true);
    setErr(null);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();

      if (userError || !userData.user) {
        setErr("Tu dois être connecté en tant que chauffeur pour voir cette page.");
        return;
      }

      const uid = userData.user.id;

      const { data: memberRow, error: memberError } = await supabase
        .from("order_members")
        .select("role")
        .eq("order_id", orderId)
        .eq("user_id", uid)
        .maybeSingle();

      if (memberError) {
        console.error("order_members read error", memberError);
        setErr("Erreur lors de la vérification de ton rôle sur la commande.");
        return;
      }

      if (!memberRow || (memberRow as MemberRow).role !== "driver") {
        setErr("Cette page est réservée au chauffeur assigné sur cette commande.");
        return;
      }

      const { data: orderRow, error: orderError } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("id", orderId)
        .maybeSingle();

      if (orderError) {
        console.error("orders read error", orderError);
        setErr(orderError.message);
        return;
      }

      if (!orderRow) {
        setErr("Commande introuvable.");
        return;
      }

      setOrder(orderRow as OrderRow);
    } catch (e: any) {
      console.error("loadOrder unexpected error", e);
      setErr(e?.message ?? "Impossible de charger la commande.");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  async function handleVerifyCode() {
    if (!order || !phase || submitting) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setErrorMsg("Merci de saisir le code.");
      return;
    }

    setSubmitting(true);

    try {
      const codeType = phase === "pickup" ? "pickup" : "dropoff";

      const { data, error } = await supabase.rpc("verify_order_code", {
        p_order_id: order.id,
        p_input_code: trimmedCode,
        p_code_type: codeType,
      });

      if (error) {
        console.error("verify_order_code error (driver web)", error);
        setErrorMsg(
          error.message || "Erreur serveur pendant la vérification du code."
        );
        return;
      }

      const anyData = data as any;

      if (!anyData || anyData.success !== true) {
        const msg =
          anyData?.message ?? "Code incorrect ou non défini pour cette commande.";
        setErrorMsg(msg);
        return;
      }

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        console.error("getSession error", sessionError);
        setErrorMsg(
          sessionError.message || "Impossible de récupérer la session."
        );
        return;
      }

      const token = sessionData?.session?.access_token;
      if (!token) {
        setErrorMsg("Token de session manquant.");
        return;
      }

      const endpoint =
        phase === "pickup"
          ? "/api/orders/pickup-confirm"
          : "/api/orders/delivered-confirm";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ order_id: order.id }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        console.error("confirm route error", result);
        setErrorMsg(
          result?.error ||
            `Échec de la confirmation ${
              phase === "pickup" ? "pickup" : "delivery"
            }.`
        );
        return;
      }

      const { data: refreshedOrder, error: refreshError } = await supabase
        .from("orders")
        .select(ORDER_SELECT)
        .eq("id", order.id)
        .maybeSingle();

      if (refreshError || !refreshedOrder) {
        console.error("refresh order error", refreshError);
        setErrorMsg(
          refreshError?.message ||
            "Confirmation réussie, mais impossible de recharger la commande."
        );
        return;
      }

      setOrder(refreshedOrder as OrderRow);
      setCode("");
      setPhase(null);

      const successText =
        phase === "pickup"
          ? "Code de ramassage validé. Pickup confirmé avec succès."
          : "Code de livraison validé. Livraison confirmée avec succès.";

      setSuccessMsg(successText);
    } catch (e: any) {
      console.error("handleVerifyCode unexpected error", e);
      setErrorMsg(
        e?.message || "Une erreur inattendue est survenue pendant la confirmation."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6">
        <p className="text-sm text-gray-600">Chargement de la course…</p>
      </main>
    );
  }

  if (err) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <button
          type="button"
          onClick={() => router.push("/orders/driver")}
          className="text-xs text-blue-600 underline"
        >
          ← Retour au tableau de bord chauffeur
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
          onClick={() => router.push("/orders/driver")}
          className="text-xs text-blue-600 underline"
        >
          ← Retour au tableau de bord chauffeur
        </button>
        <p className="text-sm text-gray-600">Commande introuvable.</p>
      </main>
    );
  }

  const shortId = order.id.slice(0, 8);
  const distanceLabel =
    order.distance_miles != null ? `${order.distance_miles.toFixed(1)} mi` : "—";
  const etaLabel =
    order.eta_minutes != null ? `${Math.round(order.eta_minutes)} min` : "—";

  const currency = order.currency || "USD";
  const driverPay =
    order.delivery_fee != null ? computeDriverPay(order.delivery_fee) : null;

  const canPickup = order.status === "ready";
  const canDropoff = order.status === "dispatched";

  const phaseHelpText =
    phase === "pickup"
      ? "Demande au restaurant de te montrer le code ou le QR de ramassage, puis tape-le exactement ici."
      : phase === "dropoff"
        ? "Demande au client de te montrer le code ou le QR de livraison, puis tape-le exactement ici."
        : "";

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={() => router.push("/orders/driver")}
        className="text-xs text-blue-600 underline"
      >
        ← Retour au tableau de bord chauffeur
      </button>

      <header className="space-y-1">
        <h1 className="text-xl font-bold">Course — commande #{shortId}</h1>
        <p className="text-sm text-gray-600">
          Vue dédiée au chauffeur. Tu vois les infos de la course (adresses,
          distance, temps estimé) et ta rémunération estimée.
        </p>
        <div className="inline-flex items-center rounded-full border bg-blue-50 border-blue-200 px-3 py-1 text-xs font-medium text-blue-700 mt-2">
          Statut : {driverStatusLabel(order.status)}
        </div>
      </header>

      <section className="border rounded-xl bg-white p-4 space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">
          Adresses de la course
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-500">
              Retrait (pickup)
            </p>
            <p className="text-sm text-gray-800">
              {order.pickup_address || "Adresse de retrait non renseignée"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500">
              Livraison (dropoff)
            </p>
            <p className="text-sm text-gray-800">
              {order.dropoff_address || "Adresse de livraison non renseignée"}
            </p>
          </div>
        </div>
      </section>

      <section className="border rounded-xl bg-white p-4 space-y-2 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">Course</h2>
        <p>
          <span className="font-medium">Distance :</span> {distanceLabel}
        </p>
        <p>
          <span className="font-medium">Temps estimé :</span> {etaLabel}
        </p>
        <p className="text-xs text-gray-500">
          Commande créée le : {formatDate(order.created_at)}
        </p>
      </section>

      <section className="border rounded-xl bg-white p-4 space-y-2 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">
          Ta rémunération chauffeur (estimation)
        </h2>

        {driverPay != null ? (
          <p className="text-sm text-gray-800">
            Ta part chauffeur estimée :{" "}
            <span className="font-semibold">
              {driverPay.toFixed(2)} {currency}
            </span>
          </p>
        ) : (
          <p className="text-sm text-gray-700">
            Le montant de la livraison n&apos;est pas encore renseigné pour cette
            course. Ta rémunération estimée apparaîtra ici dès que cette
            information sera disponible.
          </p>
        )}

        <p className="text-xs text-gray-500">
          Estimation basée sur la formule officielle MMD Delivery : 80 % du prix
          de la livraison pour le chauffeur et 20 % pour la plateforme.
        </p>
      </section>

      <section className="border rounded-xl bg-white p-4 space-y-3 text-sm">
        <h2 className="text-sm font-semibold text-gray-800">
          Actions chauffeur (code de ramassage / livraison)
        </h2>

        <button
          type="button"
          disabled={!canPickup || submitting}
          onClick={() => {
            setPhase("pickup");
            setErrorMsg(null);
            setSuccessMsg(null);
            setCode("");
          }}
          className={`w-full rounded-md px-3 py-2 text-sm font-medium ${
            canPickup && !submitting
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          }`}
        >
          Je récupère la commande (saisir le code de ramassage)
        </button>

        <button
          type="button"
          disabled={!canDropoff || submitting}
          onClick={() => {
            setPhase("dropoff");
            setErrorMsg(null);
            setSuccessMsg(null);
            setCode("");
          }}
          className={`w-full rounded-md px-3 py-2 text-sm font-medium ${
            canDropoff && !submitting
              ? "bg-green-600 text-white hover:bg-green-700"
              : "bg-gray-300 text-gray-500 cursor-not-allowed"
          }`}
        >
          Je livre la commande (saisir le code de livraison)
        </button>

        {phase && (
          <div className="space-y-3 rounded-lg border p-3 mt-2">
            <h3 className="text-sm font-semibold">
              {phase === "pickup" ? "Code de ramassage" : "Code de livraison"}
            </h3>
            <p className="text-xs text-gray-600">{phaseHelpText}</p>
            <input
              type="text"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={submitting}
              className="w-full rounded-md border px-3 py-2 text-lg tracking-[0.3em]"
              placeholder="••••••"
            />
            <button
              type="button"
              onClick={handleVerifyCode}
              disabled={submitting}
              className={`w-full rounded-md px-3 py-2 text-xs font-medium ${
                submitting
                  ? "bg-gray-400 text-white cursor-not-allowed"
                  : "bg-black text-white hover:bg-gray-800"
              }`}
            >
              {submitting ? "Validation..." : "Valider le code"}
            </button>
          </div>
        )}

        {errorMsg && (
          <p className="text-xs text-red-600 font-medium mt-1">{errorMsg}</p>
        )}
        {successMsg && (
          <p className="text-xs text-green-600 font-medium mt-1">
            {successMsg}
          </p>
        )}
      </section>

      <div className="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.push(`/orders/${order.id}/chat`)}
          className="px-3 py-1.5 rounded-lg border bg-white hover:bg-gray-50 text-xs font-medium"
        >
          Ouvrir le chat
        </button>
      </div>
    </main>
  );
}