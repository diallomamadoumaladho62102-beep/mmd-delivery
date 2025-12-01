"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import OrderSummary from "./OrderSummary";

type OrderRow = {
  id: string;
  items_json: any[] | null;
  subtotal: number | null;
};

export default function OrderSummaryPanel({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr(null);

      const { data, error } = await supabase
        .from("orders")
        .select("id, items_json, subtotal")
        .eq("id", orderId)
        .maybeSingle();

      if (error) {
        if (!cancelled) {
          setErr(error.message);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) {
        setOrder(data as OrderRow);
        setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  // Petit état de chargement
  if (loading) {
    return (
      <div className="border rounded-lg p-3 bg-white text-sm text-gray-500">
        Chargement des détails de la commande…
      </div>
    );
  }

  // En cas d’erreur ou si pas d’items → on n’affiche rien
  if (err || !order || !order.items_json || order.items_json.length === 0) {
    return null;
  }

  const rawItems = (order.items_json as any[]) ?? [];

  const items = rawItems.map((it, idx) => ({
    menu_item_id: String(it.menu_item_id ?? idx),
    name: String(it.name ?? "Article"),
    category: (it.category as string) ?? null,
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unit_price) || 0,
    line_total: Number(it.line_total) || 0,
  }));

  const subtotal =
    Number(order.subtotal) ||
    items.reduce((sum, it) => sum + Number(it.line_total || 0), 0);

  return <OrderSummary items={items} subtotal={subtotal} />;
}
