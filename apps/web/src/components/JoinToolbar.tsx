"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Role = "client" | "driver" | "restaurant" | "admin";

export default function JoinToolbar({ orderId }: { orderId: string }) {
  const { t } = useAdminT();

  if (!orderId) return null;
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const join = async (role: Role) => {
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.rpc("join_order", { p_order_id: orderId, p_role: role });
      if (error) setMsg(error.message);
      else setMsg(`Rejoint comme ${role} ✔`);
    } catch (e:any) {
      setMsg(e?.message ?? "Erreur");
    }
    setLoading(false);
  };

  return (
    <div className="border rounded p-3 space-y-2">
      <div className="text-sm font-medium">{t("Deviens membre de la commande :")}</div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => join("driver")} disabled={loading} className="border rounded px-3 py-1">{t("Rejoindre (driver)")}</button>
        <button onClick={() => join("client")} disabled={loading} className="border rounded px-3 py-1">{t("Rejoindre (client)")}</button>
        <button onClick={() => join("restaurant")} disabled={loading} className="border rounded px-3 py-1">{t("Rejoindre (restaurant)")}</button>
      </div>
      {msg ? <div className="text-xs">{msg}</div> : null}
    </div>
  );
}


