"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const STATUSES = ["pending", "assigned", "prepared", "ready", "dispatched", "delivered"];

export default function OrderStatusManager({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  // Charger statut + historique
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("orders").select("status").eq("id", orderId).single();
      setStatus(data?.status ?? null);

      const { data: hist } = await supabase
        .from("order_status_history")
        .select("old_status,new_status,created_at")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      setHistory(hist ?? []);
    })();

    const chan = supabase
      .channel(`order_status_${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload: any) => setStatus(payload.new.status)
      )
      .subscribe();

    return () => { supabase.removeChannel(chan); };
  }, [orderId]);

  const updateStatus = async (s: string) => {
    const { error } = await supabase.from("orders").update({ status: s }).eq("id", orderId);
    if (error) alert(error.message);
  };

  return (
    <div className="rounded-2xl border p-4 bg-white space-y-3">
      <h3 className="text-lg font-semibold">Statut de la commande</h3>
      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => updateStatus(s)}
            disabled={status === s}
            className={`px-3 py-1.5 rounded-xl text-sm border ${
              status === s ? "bg-black text-white" : "bg-gray-100"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <h4 className="font-semibold mt-3 text-sm">Historique</h4>
      <ul className="text-xs text-gray-600 space-y-1 max-h-40 overflow-y-auto">
        {history.map((h, i) => (
          <li key={i}>
            {new Date(h.created_at).toLocaleString()} — {h.old_status ?? "∅"} → {h.new_status}
          </li>
        ))}
      </ul>
    </div>
  );
}

