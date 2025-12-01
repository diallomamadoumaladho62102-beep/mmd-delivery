'use client';
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const COLORS: Record<string, string> = {
  pending: "bg-gray-200 text-gray-800",
  assigned: "bg-blue-100 text-blue-800",
  accepted: "bg-indigo-100 text-indigo-800",
  prepared: "bg-amber-100 text-amber-800",
  ready: "bg-green-100 text-green-800",
  dispatched: "bg-purple-100 text-purple-800",
  delivered: "bg-emerald-100 text-emerald-800",
  canceled: "bg-red-100 text-red-800",
};

export default function OrderStatusBadge({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("orders")
      .select("status, updated_at")
      .eq("id", orderId)
      .maybeSingle();
    if (!error && data) {
      setStatus(data.status || null);
      setUpdatedAt(data.updated_at || null);
    }
  }

  useEffect(() => {
    load();
    const ch = supabase.channel(`order-status-${orderId}`);
    ch.on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}`},
      (p:any) => {
        setStatus(p.new?.status ?? null);
        setUpdatedAt(p.new?.updated_at ?? null);
      }
    ).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [orderId]);

  const cls = COLORS[status ?? "pending"] || "bg-gray-200 text-gray-800";
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${cls}`}>
      <span className="font-medium">{status ?? "pending"}</span>
      {updatedAt && <span className="opacity-70">{new Date(updatedAt).toLocaleString()}</span>}
    </div>
  );
}

