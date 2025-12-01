"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseBrowser";

type Order = {
  id: string;
  status: string | null;
  subtotal: number | null;
  currency: string | null;
  created_at: string;
};

export default function AdminOrdersPage() {
  const [rows, setRows] = useState<Order[]>([]);
  const [status, setStatus] = useState<string>("");

  async function load() {
    let q = supabase
      .from("orders")
      .select("id, status, subtotal, currency, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (!error && data) setRows(data as Order[]);
  }

  useEffect(() => {
    load();
  }, [status]);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <h1 className="text-xl font-bold">Admin — Orders</h1>

      <div className="flex gap-2 items-center">
        <label className="text-sm">Filtre statut:</label>
        <select
          className="border rounded px-2 py-1"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">(tous)</option>
          <option value="pending">pending</option>
          <option value="assigned">assigned</option>
          <option value="accepted">accepted</option>
          <option value="prepared">prepared</option>
          <option value="ready">ready</option>
          <option value="dispatched">dispatched</option>
          <option value="delivered">delivered</option>
        </select>
        <button onClick={load} className="px-3 py-1 border rounded">
          Rafraîchir
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows.map((o) => {
          const shortId = o.id.slice(0, 8);
          return (
            <div key={o.id} className="border rounded p-3 space-y-1">
              <div className="font-medium">#{shortId}</div>
              <div className="text-sm text-gray-600">
                Statut: {o.status ?? "-"}
              </div>
              <div className="text-sm text-gray-600">
                Total: {o.subtotal ?? 0} {o.currency ?? "USD"}
              </div>
              <div className="text-xs text-gray-500">
                {new Date(o.created_at).toLocaleString()}
              </div>

              {/* 🔴 AVANT : /orders/${o.id}/chat (mauvaise route) */}
              {/* ✅ MAINTENANT : page admin de la commande */}
              <Link
                href={`/admin/orders/${o.id}`}
                className="text-blue-600 underline text-sm"
              >
                Ouvrir
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
