"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function LeaveButton({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      className="px-3 py-1.5 border rounded hover:bg-gray-50 text-sm"
      disabled={loading}
      onClick={async () => {
        try {
          setLoading(true);
          const { error } = await supabase.rpc("leave_order", { p_order_id: orderId });
          if (error) alert(error.message);
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "..." : "Quitter la commande"}
    </button>
  );
}

