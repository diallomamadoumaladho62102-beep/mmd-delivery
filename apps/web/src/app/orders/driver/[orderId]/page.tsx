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

type Order = {
  id: string;
  status: OrderStatus;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  delivery_fee: number | null;
  currency: string | null;
  created_at: string;
};

export default function DriverOrderPage() {
  const params = useParams<{ orderId: string }>();
  const orderId = params.orderId;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // états pour les codes
  const [pickupCode, setPickupCode] = useState("");
  const [dropoffCode, setDropoffCode] = useState("");
  const [verifyingPickup, setVerifyingPickup] = useState(false);
  const [verifyingDropoff, setVerifyingDropoff] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const statusLabel: Record<OrderStatus, string> = {
    pending: "En attente",
    accepted: "Acceptée par le restaurant",
    prepared: "En préparation",
    ready: "Prête (en attente du driver)",
    dispatched: "En livraison",
    delivered: "Livrée",
    canceled: "Annulée",
  };

  const shortId = useMemo(
    () => (orderId ? orderId.slice(0, 8) : ""),
    [orderId]
  );

  async function refetchOrder() {
    if (!orderId) return;

    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id,
        status,
        pickup_address,
        dropoff_address,
        distance_miles,
        eta_minutes,
        delivery_fee,
        currency,
        created_at
      `
      )
      .eq("id", orderId)
      .maybeSingle();

    if (error || !data) {
      console.error("refetchOrder driver", error);
      setErr(error?.message ?? "Commande introuvable ou inaccessible.");
      setOrder(null);
      return;
    }

    setOrder(data as Order);
  }

  useEffect(() => {
    setLoading(true);
    setErr(null);
    refetchOrder().finally(() => setLoading(false));
  }, [orderId]);

  async function handleVerifyPickupCode() {
    if (!order) return;
    if (!pickupCode.trim()) {
      setErr("Merci de saisir le code de ramassage.");
      return;
    }

    setVerifyingPickup(true);
    setErr(null);
    setSuccessMsg(null);

    const { data, error } = await supabase.rpc("verify_order_code", {
      p_order_id: order.id,
      p_input_code: pickupCode.trim(),
      p_code_type: "pickup",
    });

    setVerifyingPickup(false);

    if (error) {
      console.error("verify_order_code pickup error (driver page)", error);
      // 🔥 on affiche le vrai message d’erreur renvoyé par Supabase
      setErr(error.message || "Erreur serveur pendant la vérification du code pickup.");
      return;
    }

    console.log("verify_order_code pickup data (driver page)", data);

    if (!data || (data as any).success !== true) {
      const msg =
        (data as any)?.message ??
        "Code pickup incorrect ou non défini pour cette commande.";
      setErr(msg);
      return;
    }

    setPickupCode("");
    setErr(null);
    setSuccessMsg(
      (data as any).message ??
        "Code pickup validé. La commande passe en livraison (dispatched)."
    );
    await refetchOrder();
  }

  async function handleVerifyDropoffCode() {
    if (!order) return;
    if (!dropoffCode.trim()) {
      setErr("Merci de saisir le code de livraison.");
      return;
    }

    setVerifyingDropoff(true);
    setErr(null);
    setSuccessMsg(null);

    const { data, error } = await supabase.rpc("verify_order_code", {
      p_order_id: order.id,
      p_input_code: dropoffCode.trim(),
      p_code_type: "dropoff",
    });

    setVerifyingDropoff(false);

    if (error) {
      console.error("verify_order_code dropoff error (driver page)", error);
      // 🔥 pareil ici : message brut
      setErr(
        error.message ||
          "Erreur serveur pendant la vérification du code de livraison."
      );
      return;
    }

    console.log("verify_order_code dropoff data (driver page)", data);

    if (!data || (data as any).success !== true) {
      const msg =
        (data as any)?.message ??
        "Code de livraison incorrect ou non défini pour cette commande.";
      setErr(msg);
      return;
    }

    setDropoffCode("");
    setErr(null);
    setSuccessMsg(
      (data as any).message ??
        "Code de livraison validé. La commande passe en livrée (delivered)."
    );
    await refetchOrder();
  }

  function formatDate(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString("fr-FR");
    } catch {
      return iso;
    }
  }

  if (loading) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6">
        <p className="text-sm text-gray-600">
          Chargement des informations de la course…
        </p>
      </main>
    );
  }

  if (err && !order) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-3">
        <h1 className="text-xl font-bold">Course</h1>
        <p className="text-sm text-red-600">{err}</p>
        <Link
          href="/orders/driver"
          className="inline-flex text-sm text-emerald-700 underline"
        >
          ← Retour au tableau de bord chauffeur
        </Link>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-6">
        <p className="text-sm text-red-600">Course introuvable.</p>
      </main>
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col gap-1">
        <Link
          href="/orders/driver"
          className="text-xs text-emerald-700 underline"
        >
          ← Retour au tableau de bord chauffeur
        </Link>

        <h1 className="text-2xl font-bold">
          Course — commande #{shortId || order.id}
        </h1>
        <p className="text-sm text-gray-600">
          Vue dédiée au chauffeur. Tu vois les infos de la course (adresses,
          distance, temps estimé) et ta rémunération estimée.
        </p>
        <p className="text-xs text-gray-500">
          Statut :{" "}
          <span className="font-semibold">
            {statusLabel[order.status] ?? order.status}
          </span>
        </p>
        <p className="text-xs text-gray-500">
          Commande créée le : {formatDate(order.created_at)}
        </p>
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

      {/* Adresses */}
      <section className="border rounded-lg p-3 bg-white space-y-2 text-sm">
        <h2 className="text-sm font-semibold mb-1">Adresses de la course</h2>

        <div>
          <p className="text-xs font-semibold text-gray-700">Retrait (pickup)</p>
          <p className="text-xs text-gray-800">
            {order.pickup_address || "Adresse pickup non définie."}
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-700">
            Livraison (dropoff)
          </p>
          <p className="text-xs text-gray-800">
            {order.dropoff_address || "Adresse de livraison non définie."}
          </p>
        </div>
      </section>

      {/* Infos course + rémunération */}
      <section className="border rounded-lg p-3 bg-white space-y-1 text-sm">
        <h2 className="text-sm font-semibold mb-1">Course</h2>
        <p className="text-xs text-gray-700">
          Distance :{" "}
          {order.distance_miles != null
            ? `${order.distance_miles.toFixed(2)} mi`
            : "—"}
        </p>
        <p className="text-xs text-gray-700">
          Temps estimé :{" "}
          {order.eta_minutes != null ? `${order.eta_minutes} min` : "—"}
        </p>
        <p className="text-xs text-gray-700">
          Commande créée le : {formatDate(order.created_at)}
        </p>

        <div className="mt-2 border-t pt-2">
          <p className="text-xs font-semibold text-gray-800">
            Ta rémunération chauffeur (estimation)
          </p>
          <p className="text-xs text-gray-700">
            La distance et le temps estimé ne sont pas encore renseignés pour
            cette course. Ta rémunération estimée apparaîtra ici dès que ces
            informations seront disponibles.
          </p>
          <p className="text-[11px] text-gray-500 mt-1">
            Estimation basée sur la formule interne MMD Delivery (distance,
            temps, base, etc.). Le montant final pourra être ajusté selon les
            règles officielles MMD Delivery.
          </p>
        </div>
      </section>

      {/* Actions chauffeur */}
      <section className="border rounded-lg p-3 bg-slate-50 space-y-3 text-sm">
        <h2 className="text-sm font-semibold mb-1">
          Actions chauffeur (code de ramassage / livraison)
        </h2>

        {/* Pickup */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-800">
            Je récupère la commande (saisir le code de ramassage)
          </p>
          <p className="text-[11px] text-gray-700">
            Demande au restaurant de te montrer le code ou le QR de ramassage,
            puis tape-le exactement ici.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={pickupCode}
              onChange={(e) => setPickupCode(e.target.value)}
              placeholder="UG0XSO, RTS2S3, ..."
              className="flex-1 border rounded-md px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={verifyingPickup}
              onClick={handleVerifyPickupCode}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {verifyingPickup ? "Vérification…" : "Valider le code"}
            </button>
          </div>
        </div>

        {/* Dropoff */}
        <div className="space-y-2 border-t pt-3 mt-2">
          <p className="text-xs font-semibold text-gray-800">
            Je livre la commande (saisir le code de livraison)
          </p>
          <p className="text-[11px] text-gray-700">
            À la livraison, demande au client son code de confirmation (dropoff)
            et tape-le ici pour terminer la course.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={dropoffCode}
              onChange={(e) => setDropoffCode(e.target.value)}
              placeholder="Code de livraison"
              className="flex-1 border rounded-md px-2 py-1 text-xs"
            />
            <button
              type="button"
              disabled={verifyingDropoff}
              onClick={handleVerifyDropoffCode}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50"
            >
              {verifyingDropoff ? "Vérification…" : "Valider le code"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
