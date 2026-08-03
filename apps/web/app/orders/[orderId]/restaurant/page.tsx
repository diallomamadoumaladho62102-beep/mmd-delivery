"use client";

import { useEffect, useMemo, useState } from "react";
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
  options?: unknown;
  notes?: string | null;
  note?: string | null;
};

type OrderRow = {
  id: string;
  status: OrderStatus;
  created_at: string;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_code: string | null;
  leave_at_door: boolean | null;
  items_json: OrderItem[] | null;
  client_user_id?: string | null;
  client_id?: string | null;
};

function statusLabelForRestaurant(s: OrderStatus): string {
  switch (s) {
    case "pending":
      return "EN ATTENTE";
    case "accepted":
      return "ACCEPTÉE";
    case "prepared":
      return "EN PRÉPARATION";
    case "ready":
      return "PRÊTE";
    case "dispatched":
      return "EN LIVRAISON";
    case "delivered":
      return "LIVRÉE";
    case "canceled":
      return "ANNULÉE";
    default:
      return s;
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatOptions(options: unknown): string[] {
  if (!options) return [];
  if (typeof options === "string") {
    const t = options.trim();
    return t ? [t] : [];
  }
  if (Array.isArray(options)) {
    return options
      .map((opt) => {
        if (typeof opt === "string") return opt.trim();
        if (opt && typeof opt === "object") {
          const row = opt as Record<string, unknown>;
          return String(row.name ?? row.label ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
  }
  return [];
}

export default function RestaurantOrderPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.orderId as string;

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [clientLabel, setClientLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState<false | OrderStatus>(false);

  async function loadOrder() {
    if (!orderId) return;

    setLoading(true);
    setErr(null);

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
        pickup_code,
        leave_at_door,
        items_json,
        client_user_id,
        client_id,
        payment_status,
        kind
      `,
      )
      .eq("id", orderId)
      .eq("kind", "food")
      .eq("payment_status", "paid")
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

    const clientId = String(typedOrder.client_user_id ?? typedOrder.client_id ?? "").trim();
    if (clientId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", clientId)
        .maybeSingle();
      const full = String(profile?.full_name ?? "").trim();
      setClientLabel(full ? full.split(/\s+/)[0] : `Client ${clientId.slice(0, 8)}`);
    } else {
      setClientLabel(null);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadOrder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function updateStatus(nextStatus: OrderStatus) {
    if (!order) return;

    if (nextStatus !== "accepted" && nextStatus !== "prepared" && nextStatus !== "ready") {
      setErr("Transition de statut non supportée sur cette page.");
      return;
    }

    setSaving(nextStatus);
    setErr(null);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !sessionData.session?.access_token) {
        throw new Error("Session invalide. Reconnecte-toi.");
      }

      const res = await fetch("/api/orders/restaurant/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          status: nextStatus,
        }),
      });

      const out = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(out?.error ?? "Impossible de mettre à jour le statut de la commande.");
      }

      await loadOrder();
    } catch (e: unknown) {
      console.error(e);
      setErr(
        e instanceof Error
          ? e.message
          : "Impossible de mettre à jour le statut de la commande.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!order) return;

    const canCancel =
      order.status === "pending" ||
      order.status === "accepted" ||
      order.status === "prepared";

    if (!canCancel) {
      setErr("Cette commande ne peut plus être annulée par le restaurant.");
      return;
    }

    const ok = window.confirm(
      "Confirmer l’annulation ? Le client devra être remboursé selon la règle.",
    );

    if (!ok) return;

    setSaving("canceled");
    setErr(null);

    try {
      const { data, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message);
      }

      const token = data.session?.access_token;

      if (!token) {
        throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
      }

      const res = await fetch("/api/orders/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          role: "restaurant",
        }),
      });

      const out = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(out?.error || "Impossible d’annuler la commande.");
      }

      await loadOrder();
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Impossible d’annuler la commande.");
    } finally {
      setSaving(false);
    }
  }

  const kitchenNotes = useMemo(() => {
    if (!order?.items_json?.length) return "";
    return order.items_json
      .map((item) => String(item.notes ?? item.note ?? "").trim())
      .filter(Boolean)
      .join(" · ");
  }, [order?.items_json]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0B0F1A] text-white">
        <div className="max-w-3xl mx-auto px-4 py-8 text-sm text-slate-400">
          Chargement de la commande…
        </div>
      </main>
    );
  }

  if (err && !order) {
    return (
      <main className="min-h-screen bg-[#0B0F1A] text-white">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-3">
          <button
            type="button"
            onClick={() => router.push("/orders/restaurant")}
            className="text-xs text-amber-300 underline"
          >
            ← Retour à la liste des commandes
          </button>
          <p className="text-sm text-red-400">Erreur : {err}</p>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="min-h-screen bg-[#0B0F1A] text-white">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-3">
          <button
            type="button"
            onClick={() => router.push("/orders/restaurant")}
            className="text-xs text-amber-300 underline"
          >
            ← Retour à la liste des commandes
          </button>
          <p className="text-sm text-slate-400">Commande introuvable.</p>
        </div>
      </main>
    );
  }

  const shortId = order.id.slice(0, 8);
  const canAccept = order.status === "pending";
  const canPrepared = order.status === "accepted";
  const canReady = order.status === "prepared";
  const canCancel =
    order.status === "pending" ||
    order.status === "accepted" ||
    order.status === "prepared";
  const instructions = order.leave_at_door
    ? "Laisser à la porte."
    : null;

  return (
    <main className="min-h-screen bg-[#0B0F1A] text-white">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push("/orders/restaurant")}
            className="text-sm text-slate-300 hover:text-white"
          >
            ← Retour
          </button>
          <span className="rounded-full bg-[#F5C542] px-3 py-1 text-xs font-black uppercase tracking-wide text-black">
            {statusLabelForRestaurant(order.status)}
          </span>
        </div>

        <header className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#F5C542]">
            MMD Delivery
          </p>
          <h1 className="text-2xl font-black">Commande #{shortId}</h1>
          <p className="text-sm text-slate-400">{formatDate(order.created_at)}</p>
        </header>

        {err ? <p className="text-sm text-red-400">{err}</p> : null}

        <section className="rounded-2xl border border-slate-800 bg-[#020617] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F5C542] text-xl text-black">
              🍽️
            </div>
            <div>
              <p className="text-lg font-black">
                {order.restaurant_name || "Restaurant"}
              </p>
              <p className="text-sm text-slate-400">
                {order.pickup_address || "—"}
              </p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Livraison
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border-2 border-[#F5C542]/70 bg-white px-4 py-6 text-center text-black shadow-[0_0_40px_rgba(245,197,66,0.15)]">
          <p className="text-sm font-black tracking-wide text-amber-700">
            🔐 CODE PICKUP
          </p>
          <p className="mt-2 text-5xl font-black tracking-[0.2em]">
            {order.pickup_code || "······"}
          </p>
          <p className="mt-3 text-sm text-slate-600">
            Communiquez ce code uniquement au livreur.
          </p>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#020617] p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Client
          </p>
          <p className="font-semibold">{clientLabel || "Client"}</p>

          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 pt-2">
            Adresse de livraison
          </p>
          <p className="text-sm text-slate-200">
            {order.dropoff_address || "—"}
          </p>

          {instructions ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 pt-2">
                Instructions du client
              </p>
              <p className="text-sm text-slate-200">{instructions}</p>
            </>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-[#020617] p-4 space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Détails de la commande
          </p>
          {(order.items_json ?? []).length === 0 ? (
            <p className="text-sm text-slate-400">Aucun article.</p>
          ) : (
            order.items_json!.map((item, idx) => {
              const options = formatOptions(item.options);
              const note = String(item.notes ?? item.note ?? "").trim();
              return (
                <div
                  key={`${item.name}-${idx}`}
                  className="flex items-start gap-3 border-t border-slate-800 pt-3 first:border-t-0 first:pt-0"
                >
                  <span className="rounded-md bg-[#F5C542] px-2 py-1 text-xs font-black text-black">
                    {item.quantity}x
                  </span>
                  <div>
                    <p className="font-bold">{item.name}</p>
                    {options.map((opt) => (
                      <p key={opt} className="text-sm text-slate-400">
                        {opt}
                      </p>
                    ))}
                    {note ? (
                      <p className="text-sm text-amber-200/90">※ {note}</p>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </section>

        {kitchenNotes ? (
          <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4">
            <p className="text-sm font-black text-[#F5C542]">
              👨‍🍳 Note cuisine
            </p>
            <p className="mt-2 text-base font-semibold text-amber-100">
              {kitchenNotes}
            </p>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-800 bg-[#020617] p-4 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Préparation
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canAccept || !!saving}
              onClick={() => void updateStatus("accepted")}
              className={`rounded-xl px-3 py-3 text-sm font-bold ${
                canAccept && !saving
                  ? "bg-orange-600 text-white"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {saving === "accepted" ? "…" : "Accepter"}
            </button>
            <button
              type="button"
              disabled={!canPrepared || !!saving}
              onClick={() => void updateStatus("prepared")}
              className={`rounded-xl px-3 py-3 text-sm font-bold ${
                canPrepared && !saving
                  ? "bg-amber-500 text-black"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {saving === "prepared" ? "…" : "En préparation"}
            </button>
            <button
              type="button"
              disabled={!canReady || !!saving}
              onClick={() => void updateStatus("ready")}
              className={`rounded-xl px-3 py-3 text-sm font-bold ${
                canReady && !saving
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {saving === "ready" ? "…" : "Marquer prête"}
            </button>
            <button
              type="button"
              disabled={!canCancel || !!saving}
              onClick={() => void handleCancel()}
              className={`rounded-xl px-3 py-3 text-sm font-bold ${
                canCancel && !saving
                  ? "bg-red-700 text-white"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {saving === "canceled"
                ? "…"
                : order.status === "pending"
                  ? "Refuser"
                  : "Annuler"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
