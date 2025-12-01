"use client";
import AdminOnly from "@/components/AdminOnly";
import { supabase } from "@/lib/supabaseBrowser";
import { useState } from "react";
import AdminCommissionsTable from "@/components/AdminCommissionsTable";

export default function AdminPage() {
  const [busy, setBusy] = useState(false);

  async function recalcAll() {
    try {
      setBusy(true);
      const { data: orders, error } = await supabase
        .from("orders")
        .select("id, order_type, subtotal, delivery_fee, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;

      for (const o of orders ?? []) {
        await supabase.rpc("refresh_order_commissions", { p_order_id: o.id });
      }
      alert("Recalcul terminé pour " + (orders?.length ?? 0) + " commande(s).");
    } catch (e: any) {
      alert(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminOnly>
      <div className="max-w-3xl mx-auto p-6 space-y-3">
        <h1 className="text-2xl font-bold">Admin — Tableau de bord</h1>
        <p className="text-sm text-gray-600">
          Bienvenue ! Cette page est visible uniquement si votre profil <code>is_admin</code> = true.
        </p>

        <div className="flex items-center gap-3">
          <a href="/orders/a2b2d759-132b-4bd0-bfe9-db8f11f996d6/chat" className="text-sm underline">
            Ouvrir la commande #a2b2d759…
          </a>

          <button
            onClick={recalcAll}
            disabled={busy}
            className="ml-auto text-xs px-3 py-1 rounded bg-black text-white disabled:opacity-50"
            title="Recalculer les commissions des dernières commandes"
          >
            {busy ? "Recalcul…" : "Recalculer tout"}
          </button>
        </div>

        <AdminCommissionsTable />
      </div>
    </AdminOnly>
  );
}
