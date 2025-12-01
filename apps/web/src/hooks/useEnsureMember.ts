"use client";
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export function useEnsureMember(orderId?: string, role: string = "member") {
  const triedRef = useRef(false);

  useEffect(() => {
    if (!orderId || triedRef.current) return;
    triedRef.current = true;

    (async () => {
      try {
        // join discret; si déjà membre, l'upsert ne casse rien
        const { error } = await supabase.rpc("join_order", { p_order_id: orderId, p_role: role });
        if (error) {
          console.warn("[useEnsureMember] join_order error:", error.message);
        }
      } catch (e) {
        console.warn("[useEnsureMember] exception:", e);
      }
    })();
  }, [orderId, role]);
}

