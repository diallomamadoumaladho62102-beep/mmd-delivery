"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function OrderHistory({ params }: { params: { orderId: string } }) {
  const [events, setEvents] = useState<any[]>([]);
  const orderId = params.orderId;

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("order_status_history")
        .select("*")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false });
      setEvents(data || []);
    })();
  }, [orderId]);

  return (
    <main className="p-4">
      <h1 className="text-xl font-bold mb-3">Historique de la commande</h1>
      <ul className="space-y-2">
        {events.map((e) => (
          <li key={e.id} className="border rounded p-2">
            <strong>{e.old_status} → {e.new_status}</strong>
            <div className="text-xs text-gray-500">{new Date(e.created_at).toLocaleString()}</div>
          </li>
        ))}
      </ul>
    </main>
  );
}
