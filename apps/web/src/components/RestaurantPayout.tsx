"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = { net: number; currency: string };

export default function RestaurantPayout({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);

  useEffect(() => {
    (async () => {
      const { data: order } = await supabase
        .from("orders")
        .select("subtotal, currency")
        .eq("id", orderId)
        .maybeSingle();

      const { data: comm } = await supabase
        .from("order_commissions")
        .select("restaurant_fee")
        .eq("order_id", orderId)
        .maybeSingle();

      if (order && comm) {
        const subtotal = Number(order.subtotal ?? 0);
        const fee = Number((comm as any).restaurant_fee ?? 0);
        const net = Math.round((subtotal - fee) * 100) / 100;
        setRow({ net, currency: order.currency || "USD" });
      } else {
        setRow({ net: 0, currency: order?.currency || "USD" });
      }
    })();
  }, [orderId]);

  if (!row) return null;
  const fmt = (n:number,c="USD") => new Intl.NumberFormat(undefined,{style:"currency",currency:c}).format(n);

  return (
    <div className="rounded-2xl p-4 border shadow-sm">
      <div className="text-xs text-gray-500">Net restaurant (subtotal − 15%)</div>
      <div className="text-xl font-semibold">{fmt(row.net, row.currency)}</div>
    </div>
  );
}

