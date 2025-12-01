"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const STATUSES = ["assigned","accepted","prepared","ready","dispatched","delivered"];

export default function OrderStatusSimulator({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  async function setStatus(s: string) {
    setLoading(true);
    const { error } = await supabase.from("orders").update({ status: s }).eq("id", orderId);
    setLoading(false);
    if (error) alert(error.message);
  }
  return (
    <div className="flex gap-2 items-center text-sm">
      <span>Simuler statut:</span>
      {STATUSES.map(s => (
        <button
          key={s}
          onClick={() => setStatus(s)}
          className="px-2 py-1 border rounded hover:bg-gray-50"
          disabled={loading}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

