"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = { id: string; subtotal: number | null; currency: string | null; payment_status: string | null; tip: number | null };

export default function OrderPayment({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  function fmtMoney(n: number | null | undefined, ccy: string | null | undefined) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: ccy || "USD" })
      .format(Number.isFinite(Number(n)) ? Number(n) : 0);
  }

  async function load() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("orders")
        .select("id,subtotal,currency,payment_status,tip")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      setRow(data as Row | null);
    } catch (e:any) {
      setErr(e?.message || String(e));
    }
  }

  async function setPay(status: string) {
    try {
      setLoading(status); setErr(null);
      const { error } = await supabase.rpc("set_payment_status", { p_order_id: orderId, p_pay_status: status });
      if (error) throw error;
      await load();
    } catch (e:any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(null);
    }
  }

  useEffect(() => { void load(); }, [orderId]);

  if (!row) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs text-gray-500">Paiement</div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Sous-total</div>
          <div className="font-semibold">{fmtMoney(row.subtotal, row.currency)}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Pourboire</div>
          <div className="font-semibold">{fmtMoney(row.tip, row.currency)}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Statut paiement</div>
          <div className="uppercase tracking-wide">{row.payment_status || "unpaid"}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {["unpaid","authorized","paid","refunded","failed"].map(s => (
          <button key={s}
            onClick={() => setPay(s)}
            disabled={loading!==null}
            className={`px-3 py-1.5 text-sm rounded border ${row.payment_status===s ? "bg-black text-white" : "hover:bg-gray-50"}`}
          >
            {loading===s ? "..." : s}
          </button>
        ))}
      </div>
      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}

