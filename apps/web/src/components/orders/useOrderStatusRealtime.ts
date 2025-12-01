"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type OrderRow = {
  id: string;
  status: string;
};

export function useOrderStatusRealtime(
  orderId: string,
  onStatusChange: (newStatus: string, oldStatus: string | null) => void
) {
  useEffect(() => {
    const channel = supabase
      .channel(`order-status-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          const oldRow = payload.old as OrderRow;
          const newRow = payload.new as OrderRow;
          if (oldRow.status !== newRow.status) {
            onStatusChange(newRow.status, oldRow.status ?? null);
          }
        }
      )
      .subscribe((status) => {
        console.log("Order status realtime:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, onStatusChange]);
}
