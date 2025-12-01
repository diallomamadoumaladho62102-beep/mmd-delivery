"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const ALL = ["pending","accepted","prepared","ready","dispatched","delivered","canceled"] as const;
type S = typeof ALL[number];

export default function OrderStatusControls({ orderId }: { orderId: string }) {
  const [current, setCurrent] = useState<S | null>(null);
  const [next, setNext] = useState<S>("accepted");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function fetchStatus() {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .single();
    if (!error && data) {
      setCurrent(data.status as S);
      // propose un choix par défaut raisonnable
      const def = data.status === "pending" ? "accepted" : data.status === "accepted" ? "prepared" : "ready";
      setNext((def as S) ?? "accepted");
    }
    setLoading(false);
  }

  useEffect(() => { fetchStatus(); }, [orderId]);

  const apply = async () => {
    setMsg(null);
    setLoading(true);
    const { data, error } = await supabase.rpc("transition_order_status", {
      p_order_id: orderId,
      p_new_status: next
    });
    if (error) {
      setMsg(error.message);
    } else {
      setMsg(`OK: ${data?.[0]?.old_status ?? current} → ${data?.[0]?.new_status ?? next}`);
      await fetchStatus();
    }
    setLoading(false);
  };

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-sm">Statut actuel:</div>
        <div className="px-2 py-1 rounded bg-gray-100 text-sm">{current ?? "-"}</div>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={next}
          onChange={(e) => setNext(e.target.value as S)}
          className="border rounded px-2 py-1"
        >
          {ALL.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={apply} disabled={loading} className="border rounded px-3 py-1">
          {loading ? "Mise à jour…" : "Mettre à jour"}
        </button>
        <button onClick={fetchStatus} disabled={loading} className="text-sm underline">
          Rafraîchir
        </button>
      </div>

      {msg ? <div className="text-xs">{msg}</div> : null}
    </div>
  );
}
