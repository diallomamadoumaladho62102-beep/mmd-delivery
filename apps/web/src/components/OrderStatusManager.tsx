"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type OrderStatus =
  | "pending"
  | "assigned"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered";

type HistoryRow = {
  old_status: string | null;
  new_status: string | null;
  created_at: string;
};

const SAFE_DIRECT_STATUSES: OrderStatus[] = [
  "pending",
  "assigned",
  "prepared",
  "ready",
];

const BLOCKED_STATUSES = new Set<OrderStatus>(["dispatched", "delivered"]);

function formatStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "pending";
    case "assigned":
      return "assigned";
    case "prepared":
      return "prepared";
    case "ready":
      return "ready";
    case "dispatched":
      return "dispatched";
    case "delivered":
      return "delivered";
    default:
      return status;
  }
}

export default function OrderStatusManager({
  orderId,
}: {
  orderId: string;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const blockedStatusText = useMemo(
    () =>
      'Les statuts "dispatched" et "delivered" sont protégés. Utilise les routes métier dédiées (pickup-confirm / delivered-confirm).',
    []
  );

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setLoading(true);
      setErrorMsg(null);

      try {
        const [{ data: orderData, error: orderError }, { data: histData, error: histError }] =
          await Promise.all([
            supabase.from("orders").select("status").eq("id", orderId).single(),
            supabase
              .from("order_status_history")
              .select("old_status,new_status,created_at")
              .eq("order_id", orderId)
              .order("created_at", { ascending: false }),
          ]);

        if (orderError) {
          throw orderError;
        }

        if (histError) {
          throw histError;
        }

        if (!isMounted) return;

        setStatus(orderData?.status ?? null);
        setHistory((histData as HistoryRow[]) ?? []);
      } catch (e: any) {
        if (!isMounted) return;
        setErrorMsg(e?.message ?? "Impossible de charger le statut de la commande.");
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    void loadData();

    const chan = supabase
      .channel(`order_status_${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload: any) => {
          if (!isMounted) return;
          setStatus(payload?.new?.status ?? null);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "order_status_history",
          filter: `order_id=eq.${orderId}`,
        },
        (payload: any) => {
          if (!isMounted) return;
          const newRow = payload?.new as HistoryRow | undefined;
          if (!newRow) return;
          setHistory((prev) => [newRow, ...prev]);
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      supabase.removeChannel(chan);
    };
  }, [orderId]);

  const updateStatus = async (nextStatus: OrderStatus) => {
    if (!orderId) return;

    setErrorMsg(null);

    if (BLOCKED_STATUSES.has(nextStatus)) {
      setErrorMsg(blockedStatusText);
      return;
    }

    if (status === nextStatus) {
      return;
    }

    setUpdatingStatus(nextStatus);

    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: nextStatus })
        .eq("id", orderId);

      if (error) {
        throw error;
      }

      setStatus(nextStatus);
    } catch (e: any) {
      setErrorMsg(
        e?.message ?? "Impossible de mettre à jour le statut de la commande."
      );
    } finally {
      setUpdatingStatus(null);
    }
  };

  return (
    <div className="rounded-2xl border p-4 bg-white space-y-3">
      <h3 className="text-lg font-semibold">Statut de la commande</h3>

      {loading ? (
        <p className="text-sm text-gray-500">Chargement…</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {SAFE_DIRECT_STATUSES.map((s) => {
              const isCurrent = status === s;
              const isBusy = updatingStatus === s;

              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => void updateStatus(s)}
                  disabled={isCurrent || updatingStatus !== null}
                  className={`px-3 py-1.5 rounded-xl text-sm border ${
                    isCurrent
                      ? "bg-black text-white"
                      : "bg-gray-100 hover:bg-gray-200"
                  } ${updatingStatus !== null ? "disabled:opacity-60" : ""}`}
                >
                  {isBusy ? "Mise à jour..." : formatStatusLabel(s)}
                </button>
              );
            })}
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-semibold">Statuts protégés</p>
            <p className="mt-1">
              dispatched / delivered ne sont plus modifiables directement ici.
            </p>
          </div>

          {errorMsg && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          <h4 className="font-semibold mt-3 text-sm">Historique</h4>
          <ul className="text-xs text-gray-600 space-y-1 max-h-40 overflow-y-auto">
            {history.length === 0 ? (
              <li>Aucun historique disponible.</li>
            ) : (
              history.map((h, i) => (
                <li key={`${h.created_at}-${h.new_status ?? "null"}-${i}`}>
                  {new Date(h.created_at).toLocaleString()} —{" "}
                  {h.old_status ?? "∅"} → {h.new_status ?? "∅"}
                </li>
              ))
            )}
          </ul>
        </>
      )}
    </div>
  );
}