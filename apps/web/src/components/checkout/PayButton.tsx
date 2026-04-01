"use client";

import { useState } from "react";

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
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (typeof window !== "undefined") {
        const token = localStorage.getItem("sb-access-token");
        if (token) {
          headers.Authorization = `Bearer ${token}`;
        }
      }

      const res = await fetch("/api/stripe/client/checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({ order_id: orderId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || `Checkout failed (${res.status})`);
      }

      if (!data?.url) {
        throw new Error("Checkout URL missing");
      }

      window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || "Error");
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
        {loading ? "Paiement..." : "Payer"}
      </button>

      {error ? (
        <div style={{ marginTop: 8, color: "crimson", fontSize: 13 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}