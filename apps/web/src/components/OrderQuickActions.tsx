"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const FLOW = ["pending","assigned","accepted","prepared","ready","dispatched","delivered"];

export default function OrderQuickActions({ orderId, current, role }: { orderId: string; current?: string | null; role?: string | null }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function setStatus(s: string) {
    try {
      setErr(null); setLoading(s);
      const { data, error } = await supabase.rpc("set_order_status_quick", { p_order_id: orderId, p_new_status: s });
      if (error) throw error;
      // no-op, les autres composants en temps réel rechargeront
    } catch (e:any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(null);
    }
  }

  const nexts = FLOW; // on affiche toute la liste (simple). On peut filtrer selon role si besoin.

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">Actions statut {role ? `(${role})` : ""}</div>
      <div className="flex flex-wrap gap-2">
        {nexts.map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            disabled={loading!==null}
            className={`px-3 py-1.5 text-sm rounded border ${current===s ? "bg-black text-white" : "hover:bg-gray-50"}`}
            title={current===s ? "Statut actuel" : `Passer à ${s}`}
          >
            {loading===s ? "..." : s}
          </button>
        ))}
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}

