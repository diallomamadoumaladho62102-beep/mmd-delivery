"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

const COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-900 border-yellow-300",
  assigned: "bg-blue-100 text-blue-900 border-blue-300",
  prepared: "bg-indigo-100 text-indigo-900 border-indigo-300",
  ready: "bg-teal-100 text-teal-900 border-teal-300",
  dispatched: "bg-purple-100 text-purple-900 border-purple-300",
  delivered: "bg-green-100 text-green-900 border-green-300",
  canceled: "bg-red-100 text-red-900 border-red-300",
};

export default function StatusBanner({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("orders").select("status").eq("id", orderId).single()
      .then(({ data }) => setStatus(data?.status ?? null));

    const chan = supabase
      .channel(`status_banner_${orderId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `id=eq.${orderId}` },
        (payload: any) => setStatus(payload.new.status)
      )
      .subscribe();

    return () => { supabase.removeChannel(chan); };
  }, [orderId]);

  const cls = status ? (COLORS[status] ?? "bg-gray-100 text-gray-900 border-gray-300") : "bg-gray-100 text-gray-900 border-gray-300";
  const label = status ?? "—";

  return (
    <div className={`border rounded-xl px-3 py-2 inline-flex items-center gap-2 ${cls}`}>
      <span className="h-2 w-2 rounded-full bg-current inline-block opacity-70"></span>
      <span className="font-medium capitalize">{label}</span>
    </div>
  );
}

