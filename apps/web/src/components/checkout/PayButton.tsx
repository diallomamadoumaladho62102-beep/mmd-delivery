"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Props = {
  orderId: string;
  disabled?: boolean;
  className?: string;
};

export default function PayButton({ orderId, disabled, className }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setError(null);
    setLoading(true);

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session?.access_token) {
        throw new Error("Tu dois être connecté pour payer.");
      }

      const res = await fetch("/api/stripe/client/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: JSON.stringify({ order_id: orderId }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        url?: string;
      };

      if (!res.ok) {
        if (data?.error === "payment_already_succeeded") {
          throw new Error(
            "Paiement déjà reçu. Actualise la page dans quelques secondes."
          );
        }
        throw new Error(data?.error || `Checkout failed (${res.status})`);
      }

      if (!data?.url) {
        throw new Error("Checkout URL missing");
      }

      window.location.href = data.url;
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Erreur lors du paiement";
      setError(message);
      setLoading(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handlePay}
        disabled={disabled || loading || !orderId}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ddd",
          cursor: disabled || loading ? "not-allowed" : "pointer",
          opacity: disabled || loading ? 0.6 : 1,
        }}
      >
        {loading ? "Paiement..." : "Payer avec Stripe"}
      </button>

      {error ? (
        <div style={{ marginTop: 8, color: "crimson", fontSize: 13 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
