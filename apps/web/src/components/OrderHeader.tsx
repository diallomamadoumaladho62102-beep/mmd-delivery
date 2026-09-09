"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type OrderStatus =
  | "pending"
  | "assigned"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "cancelled"
  | string;

type Order = {
  id: string;
  status: OrderStatus | null;
  kind?: string | null;
  created_at?: string | null;
};

type MemberRole = "client" | "driver" | "restaurant" | "admin" | string | null;

function statusLabel(
  status: OrderStatus | null,
  t: (source: string) => string,
): string {
  if (!status) return t("Inconnu");
  switch (status) {
    case "pending":
      return t("En attente");
    case "assigned":
      return t("Assignée");
    case "accepted":
      return t("Acceptée");
    case "prepared":
      return t("Préparée");
    case "ready":
      return t("Prête");
    case "dispatched":
      return t("En livraison");
    case "delivered":
      return t("Livrée");
    case "cancelled":
      return t("Annulée");
    default:
      return String(status);
  }
}

function roleLabel(role: MemberRole, t: (source: string) => string): string {
  if (!role) return t("Non membre");
  if (role === "client") return t("Client");
  if (role === "driver") return t("Chauffeur / Livreur");
  if (role === "restaurant") return t("Restaurant");
  if (role === "admin") return t("Administrateur");
  return String(role);
}

export default function OrderHeader({ orderId }: { orderId: string }) {
  const { t } = useAdminT();

  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [myRole, setMyRole] = useState<MemberRole>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      // 1) user
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr) {
        if (!cancelled) {
          setErr(userErr.message);
          setLoading(false);
        }
        return;
      }
      const user = userData.user;

      // 2) order
      const { data: ord, error: ordErr } = await supabase
        .from("orders")
        .select("id, status, kind, created_at")
        .eq("id", orderId)
        .maybeSingle();

      if (ordErr) {
        if (!cancelled) {
          setErr(ordErr.message);
          setLoading(false);
        }
        return;
      }

      // 3) rôle dans la commande
      let role: MemberRole = null;
      if (user) {
        const { data: member, error: memberErr } = await supabase
          .from("order_members")
          .select("role")
          .eq("order_id", orderId)
          .eq("user_id", user.id)
          .maybeSingle();

        if (!memberErr && member) {
          role = (member as any).role ?? null;
        }
      }

      if (!cancelled) {
        setOrder(ord as Order | null);
        setMyRole(role);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const shortId = order?.id ? order.id.slice(0, 8) : orderId.slice(0, 8);
  const created =
    order?.created_at && !Number.isNaN(Date.parse(order.created_at))
      ? new Date(order.created_at).toLocaleString()
      : null;

  return (
    <div className="mb-4 border rounded-xl p-4 bg-white flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-gray-500">{t("Chat — commande")}</div>
          <div className="text-lg font-semibold">
            #{shortId}
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push("/orders/my")}
          className="px-3 py-1.5 rounded-full border text-xs"
        >
          ← Mes commandes
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-gray-500">{t("Statut :")}</span>
          {loading ? (
            <span className="text-gray-400">{t("Chargement…")}</span>
          ) : (
            <span className="px-2 py-0.5 rounded-full bg-gray-100">
              {statusLabel(order?.status ?? null, t)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <span className="text-gray-500">{t("Ton rôle :")}</span>
          <span className="font-medium">{roleLabel(myRole, t)}</span>
        </div>

        {order?.kind && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">{t("Type :")}</span>
            <span>{order.kind}</span>
          </div>
        )}

        {created && (
          <div className="flex items-center gap-1">
            <span className="text-gray-500">{t("Créée le :")}</span>
            <span>{created}</span>
          </div>
        )}
      </div>

      {err && (
        <div className="text-[11px] text-red-600">
          Erreur: {err}
        </div>
      )}
    </div>
  );
}
