"use client";
import { supabase } from "@/lib/supabaseBrowser";

export default function PaymentButtons({ orderId }: { orderId: string }) {
  async function setPay(status: "unpaid" | "authorized" | "paid" | "refunded" | "failed") {
    const { data, error } = await supabase.rpc("set_payment_status", {
      p_order_id: orderId,
      p_status: status,
    });
    if (error) alert(error.message);
    else console.log("OK:", data);
  }

  return (
    <div className="flex gap-2 flex-wrap">
      {["unpaid", "authorized", "paid", "refunded", "failed"].map((s) => (
        <button
          key={s}
          onClick={() => setPay(s as any)}
          className="border rounded px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

