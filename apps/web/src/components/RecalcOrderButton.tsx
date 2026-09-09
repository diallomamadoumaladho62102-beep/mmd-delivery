"use client";
import { useAdminT } from "@/i18n/useAdminT";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function RecalcOrderButton({ orderId }: { orderId: string }) {
  const { t } = useAdminT();
  const [loading, setLoading] = useState(false);

  async function run() {
    if (!orderId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("refresh_order_commissions_rpc", { p_order_id: orderId });
    setLoading(false);
    if (error) {
      console.error(error);
      alert(`${t("Erreur:")} ${error.message}`);
    } else {
      alert(t("Recalcul ok"));
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={loading}
      className="px-3 py-2 border rounded bg-white shadow-sm text-sm"
      title={t("Recalculer les commissions de cette commande")}
    >
      {loading ? t("Recalcul…") : t("Recalculer cette commande")}
    </button>
  );
}
