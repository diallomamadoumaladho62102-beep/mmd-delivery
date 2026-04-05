"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Props = { orderId: string };

export default function AdminCommission({ orderId }: Props) {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [row, setRow] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Vérifier le rôle admin/staff depuis profiles
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { setIsAdmin(false); setLoading(false); return; }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();

      const admin = !!profile && ["admin","staff"].includes((profile.role || "").toLowerCase());
      if (!admin) { if (alive) { setIsAdmin(false); setLoading(false); } return; }
      if (!alive) return;
      setIsAdmin(true);

      // Charger les commissions complètes via la vue globale
      const { data, error } = await supabase
        .from("v_order_commission_summary")
        .select("*")
        .eq("order_id", orderId)
        .maybeSingle();

      if (!alive) return;
      if (error) console.error(error);
      setRow(data ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [orderId]);

  if (!isAdmin) return null;
  if (loading) return <div className="text-sm text-gray-500">Chargement commissions…</div>;
  if (!row) return <div className="text-sm text-gray-500">Pas de données de commission.</div>;

  const fmt = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: row.currency || "USD" }).format(n || 0);

  return (
    <div className="rounded-2xl border p-4 shadow-sm bg-white">
      <div className="font-semibold mb-2">Commissions (admin)</div>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="text-gray-600">Sous-total</div><div className="text-right">{fmt(row.subtotal)}</div>
        <div className="text-gray-600">Client (5%)</div><div className="text-right">{fmt(row.client_amt)}</div>
        <div className="text-gray-600">Driver (5%)</div><div className="text-right">{fmt(row.driver_amt)}</div>
        <div className="text-gray-600">Restaurant (15%)</div><div className="text-right">{fmt(row.restaurant_amt)}</div>
        <div className="text-gray-600">Plateforme (total 25%)</div><div className="text-right">{fmt(row.platform_amt)}</div>
      </div>
    </div>
  );
}

