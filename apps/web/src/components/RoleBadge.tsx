"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Props = { orderId: string };

export default function RoleBadge({ orderId }: Props) {
  const [orderRole, setOrderRole] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) { if (alive) setLoading(false); return; }

      // 1) rôle de compte (admin/staff/…)
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();

      const acct = (profile?.role || "").toLowerCase();
      if (alive) setAccountRole(acct || "user");

      // 2) rôle dans la commande
      //   - on essaie d'abord la table order_members (commune dans ton projet)
      let oRole: string | null = null;
      const { data: mem } = await supabase
        .from("order_members")
        .select("role")
        .eq("order_id", orderId)
        .eq("user_id", uid)
        .maybeSingle();

      if (mem?.role) {
        oRole = String(mem.role).toLowerCase();
      } else {
        // fallback: certaines bases ont un RPC get_order_role(order_id, user_id)
        try {
          const { data: r } = await supabase.rpc("get_order_role", { p_order_id: orderId, p_user_id: uid });
          if (r) oRole = String(r).toLowerCase();
        } catch (_) {}
      }

      if (alive) {
        setOrderRole(oRole);
        setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [orderId]);

  if (loading) return null;

  const showAccount = ["admin","staff"].includes((accountRole || "").toLowerCase());

  const Chip = ({ text, variant }: { text: string; variant: "order" | "account" }) => {
    const base = "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium mr-2";
    const styles = variant === "order"
      ? "bg-blue-50 text-blue-700 border border-blue-200"
      : "bg-purple-50 text-purple-700 border border-purple-200";
    return <span className={`${base} ${styles}`}>{text}</span>;
  };

  return (
    <div className="mb-3">
      {orderRole ? (
        <Chip text={`Rôle commande : ${orderRole}`} variant="order" />
      ) : (
        <Chip text="Rôle commande : (non-membre)" variant="order" />
      )}
      {showAccount && <Chip text={`Compte : ${accountRole}`} variant="account" />}
    </div>
  );
}


