"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Props = {
  orderId: string;
  disabled?: boolean;
  className?: string;
};

export default function PayButton({ orderId, disabled, className }: Props) {
  const { t } = useAdminT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePay() {
    setError(null);
    setLoading(true);

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session?.access_token) {
        throw new Error(t("Tu dois être connecté pour payer."));
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
            t("Paiement déjà reçu. Actualise la page dans quelques secondes."),
          );
        }
        if (data?.error === "payment_intent_in_progress") {
          throw new Error(
            t("Un paiement est déjà en cours. Attends quelques secondes puis actualise."),
          );
        }
        throw new Error(data?.error || t("Erreur lors du paiement"));
      }

      if (!data?.url) {
        throw new Error(t("Erreur lors du paiement"));
      }

      window.location.href = data.url;
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : t("Erreur lors du paiement");
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
        aria-busy={loading}
        className="min-h-11 rounded-[10px] border border-[#ddd] px-3.5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? t("Paiement...") : t("Payer avec Stripe")}
      </button>

      {error ? (
        <div role="alert" className="mt-2 text-[13px] text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
