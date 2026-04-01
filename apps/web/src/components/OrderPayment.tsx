"use client";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Row = {
  id: string;
  subtotal: number | null;
  currency: string | null;
  payment_status: string | null;
  tip: number | null;
};

const PAY_STATUSES = ["unpaid", "authorized", "paid", "refunded", "failed"] as const;

export default function OrderPayment({ orderId }: { orderId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ✅ Payment status must be set by Stripe webhook/server (service role), not from the browser.
  const allowManualPaymentUpdate = false;

  const fmtMoney = useMemo(() => {
    return (n: number | null | undefined, ccy: string | null | undefined) => {
      const value = Number(n);
      const currency = (ccy || "USD").toUpperCase();
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
          Number.isFinite(value) ? value : 0
        );
      } catch {
        // Fallback if currency code is invalid
        return `${Number.isFinite(value) ? value.toFixed(2) : "0.00"} ${currency}`;
      }
    };
  }, []);

  async function load() {
    try {
      setErr(null);
      const { data, error } = await supabase
        .from("orders")
        .select("id,subtotal,currency,payment_status,tip")
        .eq("id", orderId)
        .maybeSingle();

      if (error) throw error;
      setRow((data as Row | null) ?? null);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setRow(null);
    }
  }

  // ✅ No client-side update. We just explain + refresh.
  async function handleStatusClick(status: string) {
    if (!row) return;

    if (!allowManualPaymentUpdate) {
      setErr(
        "Le statut de paiement est mis à jour automatiquement par Stripe (webhook). " +
          "Si tu viens de payer, attends quelques secondes puis actualise."
      );
      // small refresh attempt
      setLoading(true);
      try {
        await load();
      } finally {
        setLoading(false);
      }
      return;
    }

    // (If you ever enable manual updates in a protected admin-only environment,
    // do it through a server endpoint using SUPABASE_SERVICE_ROLE_KEY, not via browser RPC.)
    setErr("Action désactivée.");
  }

  useEffect(() => {
    if (!orderId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  if (!row) return null;

  const payStatus = (row.payment_status || "unpaid").toLowerCase();

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
          <div className="uppercase tracking-wide">{payStatus}</div>
        </div>

        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Mise à jour</div>
          <div className="text-sm">
            <span className="font-semibold">Stripe webhook</span>
            <div className="text-xs text-gray-500 mt-1">Auto • pas de changement manuel</div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        {PAY_STATUSES.map((s) => {
          const active = payStatus === s;
          return (
            <button
              key={s}
              onClick={() => handleStatusClick(s)}
              disabled={loading}
              title={
                allowManualPaymentUpdate
                  ? "Changer le statut (admin)"
                  : "Lecture seule — le webhook Stripe met à jour automatiquement"
              }
              className={`px-3 py-1.5 text-sm rounded border transition ${
                active ? "bg-black text-white" : "hover:bg-gray-50"
              } ${!allowManualPaymentUpdate ? "opacity-60 cursor-not-allowed" : ""}`}
            >
              {loading ? "..." : s}
            </button>
          );
        })}

        <button
          onClick={() => {
            setLoading(true);
            setErr(null);
            load().finally(() => setLoading(false));
          }}
          disabled={loading}
          className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50"
        >
          {loading ? "..." : "Rafraîchir"}
        </button>
      </div>

      {!allowManualPaymentUpdate && (
        <div className="text-xs text-gray-500">
          ✅ Le paiement est confirmé via <span className="font-semibold">/api/stripe/webhook</span>. Si tu es en local,
          assure-toi que Stripe CLI forward le webhook vers ton serveur.
        </div>
      )}

      {err && <div className="text-xs text-red-600">{err}</div>}
    </div>
  );
}
