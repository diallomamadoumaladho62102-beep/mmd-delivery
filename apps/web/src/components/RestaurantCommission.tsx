"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function RestaurantCommission({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from("v_restaurant_commission")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();
      if (!alive) return;
      if (error) console.debug("v_restaurant_commission error:", error.message);
      setRow(data ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [orderId]);

  if (loading || !row) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: row.currency || "USD" }).format(n || 0);

  return (
    <div className="rounded-2xl border p-4 shadow-sm bg-white">
      <div className="font-semibold mb-2">Votre commission (restaurant)</div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="text-gray-600">Commission (15%)</div>
        <div className="text-right">{fmt(row.restaurant_amt)}</div>
      </div>
    </div>
  );
}

