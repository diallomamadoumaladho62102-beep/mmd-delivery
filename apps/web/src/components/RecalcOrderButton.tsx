"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function RecalcOrderButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!orderId) return;
    setLoading(true);
    // Appelle la RPC safe (retourne boolean)
    const { data, error } = await supabase.rpc("refresh_order_commissions_rpc", { p_order_id: orderId });
    setLoading(false);
    if (error) {
      console.error(error);
      alert("Erreur: " + error.message);
    } else {
      alert("Recalcul ok");
    }
  }

  return (
    <button
      onClick={run}
      disabled={loading}
      className="px-3 py-2 border rounded bg-white shadow-sm text-sm"
      title="Recalculer les commissions de cette commande"
    >
      {loading ? "Recalcul…" : "Recalculer cette commande"}
    </button>
  );
}

