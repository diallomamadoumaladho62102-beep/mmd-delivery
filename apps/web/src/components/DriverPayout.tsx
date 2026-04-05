"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = { gross: number; net: number; currency: string };

export default function DriverPayout({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("orders")
        .select("delivery_pay, currency")
        .eq("id", orderId)
        .maybeSingle();

      if (data) {
        const gross = Number((data as any).delivery_pay ?? 0);
        const net = Math.round(gross * 0.95 * 100) / 100; // -5%
        setRow({ gross, net, currency: (data as any).currency || "USD" });
      } else {
        setRow({ gross: 0, net: 0, currency: "USD" });
      }
    })();
  }, [orderId]);

  if (!row) return null;
  const fmt = (n:number,c="USD") => new Intl.NumberFormat(undefined,{style:"currency",currency:c}).format(n);

  return (
    <div className="rounded-2xl p-4 border shadow-sm">
      <div className="text-xs text-gray-500">Driver payout (brut − 5%)</div>
      <div className="text-sm">Brut: {fmt(row.gross, row.currency)}</div>
      <div className="text-lg font-semibold">Net: {fmt(row.net, row.currency)}</div>
    </div>
  );
}

