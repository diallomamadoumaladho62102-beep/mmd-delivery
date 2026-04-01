"use client";
import { supabase } from "@/lib/supabaseBrowser";
import { useState } from "react";

const STATUSES = ["unpaid", "authorized", "paid", "refunded", "failed"] as const;

export default function PaymentButtons({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // ❌ Client must NOT update payment_status directly.
  // ✅ Stripe webhook (server, service role) handles it.
  async function handleClick(status: string) {
    setMessage(null);

    setLoading(status);
    try {
      // Just informational refresh — no DB write
      setMessage(
        "Le statut de paiement est mis à jour automatiquement par Stripe (webhook). " +
          "Si un paiement vient d’être effectué, attends quelques secondes puis actualise."
      );
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => handleClick(s)}
            disabled={loading !== null}
            title="Lecture seule — Stripe met à jour automatiquement"
            className="border rounded px-3 py-1.5 text-sm hover:bg-gray-50 opacity-60 cursor-not-allowed"
          >
            {loading === s ? "..." : s}
          </button>
        ))}
      </div>

      <div className="text-xs text-gray-500">
        🔒 Le statut de paiement est contrôlé par{" "}
        <span className="font-semibold">/api/stripe/webhook</span>.
      </div>

      {message && <div className="text-xs text-blue-600">{message}</div>}
    </div>
  );
}
