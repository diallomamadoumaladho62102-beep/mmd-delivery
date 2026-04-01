"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type SimulatableStatus = "assigned" | "accepted" | "prepared" | "ready";

const SAFE_SIMULATION_STATUSES: SimulatableStatus[] = [
  "assigned",
  "accepted",
  "prepared",
  "ready",
];

const BLOCKED_STATUSES = ["dispatched", "delivered"] as const;

function formatStatusLabel(status: string) {
  switch (status) {
    case "assigned":
      return "assigned";
    case "accepted":
      return "accepted";
    case "prepared":
      return "prepared";
    case "ready":
      return "ready";
    default:
      return status;
  }
}

export default function OrderStatusSimulator({
  orderId,
}: {
  orderId: string;
}) {
  const [loadingStatus, setLoadingStatus] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const blockedText = useMemo(
    () =>
      'Les statuts "dispatched" et "delivered" sont protégés. Utilise les routes métier pickup-confirm / delivered-confirm.',
    []
  );

  async function setStatus(nextStatus: SimulatableStatus) {
    if (!orderId?.trim()) {
      setErrorMsg("orderId manquant.");
      return;
    }

    setErrorMsg(null);
    setLoadingStatus(nextStatus);

    try {
      const { error } = await supabase
        .from("orders")
        .update({ status: nextStatus })
        .eq("id", orderId.trim());

      if (error) {
        throw error;
      }
    } catch (e: any) {
      setErrorMsg(
        e?.message ?? "Impossible de simuler le changement de statut."
      );
    } finally {
      setLoadingStatus(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <span className="font-medium">Simuler statut :</span>

        {SAFE_SIMULATION_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => void setStatus(status)}
            className="px-2 py-1 border rounded hover:bg-gray-50 disabled:opacity-60"
            disabled={loadingStatus !== null}
          >
            {loadingStatus === status
              ? "Mise à jour..."
              : formatStatusLabel(status)}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <p className="font-semibold">Statuts protégés</p>
        <p className="mt-1">
          {BLOCKED_STATUSES.join(" / ")} ne sont plus simulables directement.
        </p>
        <p className="mt-1">{blockedText}</p>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {errorMsg}
        </div>
      )}
    </div>
  );
}