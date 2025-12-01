// apps/web/src/components/CommissionSummary.tsx
"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type OC = {
  client_pct: number; driver_pct: number; restaurant_pct: number; platform_pct: number;
  client_amount: number; driver_amount: number; restaurant_amount: number; platform_amount: number;
  currency: string;
};

export default function CommissionSummary({ orderId }: { orderId: string }) {
  const [c, setC] = useState<OC | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const { data, error } = await supabase
      .from("order_commissions")
      .select("*").eq("order_id", orderId).maybeSingle();
    if (error) setErr(error.message);
    else setC(data as any);
  }
  useEffect(() => { load(); }, [orderId]);

  if (err) return <div className="text-red-600">{err}</div>;
  if (!c) return <div>Chargement…</div>;

  const money = (x: number) => `${x.toFixed(2)} ${c.currency}`;

  return (
    <div className="grid grid-cols-2 gap-2 text-sm">
      <div>Client: {c.client_pct}% • <b>{money(c.client_amount)}</b></div>
      <div>Driver: {c.driver_pct}% • <b>{money(c.driver_amount)}</b></div>
      <div>Restaurant: {c.restaurant_pct}% • <b>{money(c.restaurant_amount)}</b></div>
      <div>Plateforme: {c.platform_pct}% • <b>{money(c.platform_amount)}</b></div>
    </div>
  );
}
