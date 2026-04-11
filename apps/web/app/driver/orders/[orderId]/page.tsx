"use client";

import { useEffect, useState } from "react";
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
  created_at: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  driver_delivery_payout: number | null;
  driver_id: string | null;
};

type VerifyKind = "pickup" | "dropoff";

export default function DriverOrderDetailsPage() {
  const params = useParams();
  const orderId = params?.orderId as string | undefined;

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [verifyingKind, setVerifyingKind] = useState<VerifyKind | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);

  async function fetchOrder() {
    if (!orderId) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          status,
          created_at,
          restaurant_name,
          pickup_address,
          dropoff_address,
          distance_miles,
          eta_minutes,
          driver_delivery_payout,
          driver_id
        `
        )
        .eq("id", orderId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        alert("Commande introuvable.");
        return;
      }

      setOrder(data as Order);
    } catch (e: any) {
      console.error("Erreur fetch driver order details (web):", e);
      alert(e?.message ?? "Impossible de charger les détails de la commande.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  function formatDate(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  function formatStatusLabel(status: OrderStatus) {
    switch (status) {
      case "pending":
        return "En attente d’un chauffeur";
      case "accepted":
      case "prepared":
        return "En attente (restaurant)";
      case "ready":
        return "Prête pour pickup";
      case "dispatched":
        return "En livraison";
      case "delivered":
        return "Livrée";
      case "canceled":
        return "Annulée";
      default:
        return status;
    }
  }

  const canPickup = order?.status === "ready";
  const canDeliver = order?.status === "dispatched";
  const canAccept = !!order && order.status === "pending" && !order.driver_id;

  function openCodeModal(kind: VerifyKind) {
    if (kind === "pickup" && !canPickup) return;
    if (kind === "dropoff" && !canDeliver) return;
    setCodeInput("");
    setVerifyingKind(kind);
  }

  function closeCodeModal() {
    setVerifyingKind(null);
    setCodeInput("");
    setSubmittingCode(false);
  }

  async function handleAccept() {
    if (!order) return;
    try {
      setAccepting(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        console.error("Impossible d'obtenir le user", userError);
        alert("Impossible de récupérer ton profil chauffeur. Reconnecte-toi.");
        return;
      }

      console.log("📦 Acceptation commande (web) pour chauffeur :", user.id);

      const { error: updateError } = await supabase
        .from("orders")
        .update({
          driver_id: user.id,
          status: "accepted",
        })
        .eq("id", order.id)
        .is("driver_id", null);

      if (updateError) {
        console.error("❌ Erreur update orders (web):", updateError);
        alert(
          updateError.message ?? "Impossible d'accepter cette course pour le moment."
        );
        return;
      }

      const { error: joinError } = await supabase.rpc("join_order", {
        p_order_id: order.id,
        p_role: "driver",
      });

      if (joinError) {
        console.error("⚠️ Erreur join_order (web):", joinError);
      }

      await fetchOrder();
      alert("Course acceptée ✅ Tu es maintenant assigné à cette course.");
    } catch (e: any) {
      console.error("Erreur handleAccept (web):", e);
      alert(e?.message ?? "Impossible d'accepter la course pour le moment.");
    } finally {
      setAccepting(false);
    }
  }

  async function handleSubmitCode() {
    if (!order || !verifyingKind) return;
    if (!codeInput.trim()) {
      alert("Code manquant. Entre le code de vérification.");
      return;
    }

    try {
      setSubmittingCode(true);

      const { data, error } = await supabase.rpc("verify_order_code", {
        p_order_id: order.id,
        p_input_code: codeInput.trim(),
        p_code_type: verifyingKind,
      });

      if (error) {
        console.error("Erreur RPC verify_order_code (web):", error);
        alert("Erreur serveur pendant la vérification du code.");
        return;
      }

      const success = (data as any)?.success === true;
      const message =
        (data as any)?.message ??
        (verifyingKind === "pickup"
          ? "Code pickup validé."
          : "Code de livraison validé.");

      if (!success) {
        console.log("verify_order_code web data", data);
        alert(`Code invalide : ${message}`);
        return;
      }

      await fetchOrder();
      alert(message);
      closeCodeModal();
    } catch (e: any) {
      console.error("Erreur handleSubmitCode (web):", e);
      alert(e?.message ?? "Impossible de vérifier le code pour le moment.");
    } finally {
      setSubmittingCode(false);
    }
  }

  if (!orderId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-lg font-semibold">
            Aucun identifiant de commande fourni.
          </p>
          <Link
            href="/driver/dashboard"
            className="inline-flex items-center rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            ← Retour au tableau de bord chauffeur
          </Link>
        </div>
      </div>
    );
  }

  if (loading && !order) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          <p className="text-sm text-slate-300">
            Chargement de la commande...
          </p>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-lg font-semibold">Commande introuvable.</p>
          <Link
            href="/driver/dashboard"
            className="inline-flex items-center rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-100 hover:bg-slate-800"
          >
            ← Retour au tableau de bord chauffeur
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="max-w-3xl mx-auto px-4 pb-10 pt-6">
        {/* Retour */}
        <div className="mb-3">
          <Link
            href="/driver/dashboard"
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            ← Retour au tableau de bord chauffeur
          </Link>
        </div>

        {/* Titre */}
        <h1 className="text-2xl font-extrabold text-slate-50 mb-1">
          Course — commande #{order.id.slice(0, 8)}
        </h1>
        <p className="text-xs sm:text-sm text-slate-400 mb-3">
          Vue chauffeur : adresses, distance, temps estimé, codes pickup /
          livraison et rémunération.
        </p>

        {/* Statut */}
        <div className="inline-flex items-center rounded-full border border-blue-700 px-3 py-1 mb-4">
          <span className="text-xs font-semibold text-blue-100">
            Statut : {formatStatusLabel(order.status)}
          </span>
        </div>

        {/* Bouton accepter */}
        {canAccept && (
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            className="mb-4 inline-flex w-full items-center justify-center rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-70"
          >
            {accepting ? "Acceptation..." : "Accepter cette course"}
          </button>
        )}

        <p className="text-[11px] text-slate-500 mb-4">
          Commande créée le : {formatDate(order.created_at)}
        </p>

        {/* Bloc adresses */}
        <section className="mb-4 rounded-2xl border border-slate-900 bg-slate-950/60 p-4">
          <h2 className="text-sm sm:text-base font-semibold text-slate-100 mb-2">
            Adresses de la course
          </h2>

          {order.restaurant_name && (
            <p className="text-xs text-slate-400 mb-1.5">
              Restaurant :{" "}
              <span className="font-medium text-slate-100">
                {order.restaurant_name}
              </span>
            </p>
          )}

          <p className="text-xs text-slate-400 mb-1">
            Retrait{" "}
            <span className="font-medium text-slate-100">
              {order.pickup_address ?? "—"}
            </span>
          </p>
          <p className="text-xs text-slate-400">
            Livraison{" "}
            <span className="font-medium text-slate-100">
              {order.dropoff_address ?? "—"}
            </span>
          </p>
        </section>

        {/* Bloc course */}
        <section className="mb-4 rounded-2xl border border-slate-900 bg-slate-950/60 p-4">
          <h2 className="text-sm sm:text-base font-semibold text-slate-100 mb-2">
            Course
          </h2>

          <p className="text-xs text-slate-400 mb-1">
            Distance :{" "}
            <span className="font-semibold text-slate-100">
              {order.distance_miles != null
                ? `${order.distance_miles.toFixed(1)} mi`
                : "—"}
            </span>
          </p>

          <p className="text-xs text-slate-400">
            Temps estimé :{" "}
            <span className="font-semibold text-slate-100">
              {order.eta_minutes != null
                ? `${Math.round(order.eta_minutes)} min`
                : "—"}
            </span>
          </p>
        </section>

        {/* Bloc rémunération */}
        <section className="mb-4 rounded-2xl border border-slate-900 bg-slate-950/60 p-4">
          <h2 className="text-sm sm:text-base font-semibold text-slate-100 mb-2">
            Ta rémunération chauffeur (estimation)
          </h2>

          <p className="text-xs text-slate-400 mb-1.5">
            Ta part chauffeur estimée :{" "}
            <span className="font-bold text-emerald-400">
              {order.driver_delivery_payout != null
                ? `${order.driver_delivery_payout.toFixed(2)} USD`
                : "—"}
            </span>
          </p>

          <p className="text-[11px] text-slate-500">
            Basé sur la répartition officielle MMD Delivery. Le montant final
            pourra être ajusté si nécessaire.
          </p>
        </section>

        {/* Bloc codes */}
        <section className="mb-6 rounded-2xl border border-slate-900 bg-slate-950/60 p-4">
          <h2 className="text-sm sm:text-base font-semibold text-slate-100 mb-3">
            Codes de vérification
          </h2>

          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={!canPickup}
              onClick={() => openCodeModal("pickup")}
              className={`inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-semibold ${
                canPickup
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-slate-900 text-slate-500 cursor-not-allowed"
              }`}
            >
              Je récupère la commande (code de ramassage)
            </button>

            <button
              type="button"
              disabled={!canDeliver}
              onClick={() => openCodeModal("dropoff")}
              className={`inline-flex w-full items-center justify-center rounded-full px-4 py-2 text-sm font-semibold ${
                canDeliver
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "bg-slate-900 text-slate-500 cursor-not-allowed"
              }`}
            >
              Je livre la commande (code de livraison)
            </button>
          </div>
        </section>

        {/* Placeholder Chat */}
        <button
          type="button"
          disabled
          className="inline-flex w-full items-center justify-center rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-300"
        >
          Ouvrir le chat (à venir)
        </button>
      </main>

      {/* MODAL CODE */}
      {verifyingKind !== null && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-xl">
            <h3 className="text-base sm:text-lg font-semibold text-slate-50 mb-1">
              {verifyingKind === "pickup"
                ? "Code de ramassage"
                : "Code de livraison"}
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mb-3">
              Demande le code à la personne (restaurant ou client) et saisis-le
              ci-dessous.
            </p>

            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="Ex : ABC123"
              className="mb-3 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-50 placeholder:text-slate-500 outline-none focus:border-emerald-500"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeCodeModal}
                disabled={submittingCode}
                className="inline-flex items-center rounded-full border border-slate-600 px-3 py-1.5 text-xs sm:text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-60"
              >
                Annuler
              </button>

              <button
                type="button"
                onClick={handleSubmitCode}
                disabled={submittingCode}
                className="inline-flex items-center rounded-full bg-emerald-600 px-4 py-1.5 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {submittingCode ? "Vérification..." : "Valider le code"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
