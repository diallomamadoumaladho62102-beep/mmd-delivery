"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = { net: number; currency: string };

export default function RestaurantPayout({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);

  useEffect(() => {
    (async () => {
      const { data: comm } = await supabase
        .from("order_commissions")
        .select("restaurant_amount, currency")
        .eq("order_id", orderId)
        .maybeSingle();

      if (comm) {
        const net = Number((comm as any).restaurant_amount ?? 0);
        setRow({ net, currency: (comm as any).currency || "USD" });
      } else {
        setRow({ net: 0, currency: "USD" });
      }
    })();
  }, [orderId]);

  if (!row) return null;
  const fmt = (n: number, c = "USD") =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: c }).format(n);

  return (
    <div className="rounded-2xl p-4 border shadow-sm">
      <div className="text-xs text-gray-500">Net restaurant</div>
      <div className="text-xl font-semibold">{fmt(row.net, row.currency)}</div>
    </div>
  );
}