"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type OrdersJoin =
  | { order_type: string | null }
  | { order_type: string | null }[]
  | null
  | undefined;

type Row = {
  order_id: string;
  platform_pct: number | null;
  platform_amount: number | null;
  driver_pct: number | null;
  driver_amount: number | null;
  restaurant_pct: number | null;
  restaurant_amount: number | null;
  currency: string | null;
  orders?: OrdersJoin; // jointure (peut être objet OU tableau selon la relation)
};

function getOrderType(orders: OrdersJoin): string | null {
  if (!orders) return null;
  if (Array.isArray(orders)) return orders[0]?.order_type ?? null;
  return orders.order_type ?? null;
}

export default function AdminCommissionsTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<"all" | "food" | "errand">("all");

  // Helpers
  const pct = (v: number | null | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? `${v}%` : "0%";

  const money = (v: number | null | undefined, ccy?: string | null) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : 0;
    const cur = ccy || "USD";
    return `${n.toFixed(2)} ${cur}`;
  };

  async function load(currentFilter: "all" | "food" | "errand" = typeFilter) {
    setLoading(true);
    setErr(null);

    // on joint 'orders' pour avoir order_type
    let query = supabase
      .from("order_commissions")
      .select(
        "order_id, platform_pct, platform_amount, driver_pct, driver_amount, restaurant_pct, restaurant_amount, currency, updated_at, orders:orders(order_type)"
      )
      .order("updated_at", { ascending: false })
      .limit(100);

    // filtre côté SQL si demandé
    if (currentFilter !== "all") {
      query = query.eq("orders.order_type", currentFilter);
    }

    const { data, error } = await query;

    if (error) {
      setErr(error.message);
      setRows([]);
      setLoading(false);
      return;
    }

    // ✅ data est unknown-ish (selon typings supabase) -> on sécurise
    const list: Row[] = Array.isArray(data) ? (data as unknown as Row[]) : [];

    // on ne garde que les lignes avec montants > 0
    const filtered = list.filter(
      (r) =>
        (r.platform_amount ?? 0) +
          (r.driver_amount ?? 0) +
          (r.restaurant_amount ?? 0) >
        0
    );

    setRows(filtered);
    setLoading(false);
  }

  useEffect(() => {
    load(); // au montage
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load(typeFilter); // à chaque changement de filtre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  if (err) return <div className="text-red-600">{err}</div>;
  if (loading) return <div>Chargement des commissions…</div>;

  return (
    <div className="p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-lg font-semibold">💰 Dernières commissions</h2>

        {/* Sélecteur de type */}
        <select
          value={typeFilter}
          onChange={(e) =>
            setTypeFilter(e.target.value as "all" | "food" | "errand")
          }
          className="text-xs border rounded px-2 py-1"
          title="Filtrer par type de commande"
        >
          <option value="all">Tous</option>
          <option value="food">Food</option>
          <option value="errand">Errand</option>
        </select>

        <button
          onClick={() => load()}
          className="ml-auto text-xs px-2 py-1 rounded bg-black text-white"
          title="Rafraîchir"
        >
          Rafraîchir
        </button>
      </div>

      <div className="overflow-x-auto border rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-2 py-1 text-left">Commande</th>
              <th className="px-2 py-1 text-left">Type</th>
              <th className="px-2 py-1 text-left">Plateforme</th>
              <th className="px-2 py-1 text-left">Driver</th>
              <th className="px-2 py-1 text-left">Restaurant</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const orderType = getOrderType(r.orders);
              return (
                <tr key={r.order_id} className="border-t hover:bg-gray-50">
                  <td className="px-2 py-1 font-mono text-xs">
                    {r.order_id.slice(0, 8)}…
                  </td>
                  <td className="px-2 py-1">
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                      {orderType ?? "—"}
                    </span>
                  </td>
                  <td className="px-2 py-1">
                    {pct(r.platform_pct)} •{" "}
                    <b>{money(r.platform_amount, r.currency)}</b>
                  </td>
                  <td className="px-2 py-1">
                    {pct(r.driver_pct)} •{" "}
                    <b>{money(r.driver_amount, r.currency)}</b>
                  </td>
                  <td className="px-2 py-1">
                    {pct(r.restaurant_pct)} •{" "}
                    <b>{money(r.restaurant_amount, r.currency)}</b>
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-gray-500">
                  Aucune commission pour ce filtre.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}