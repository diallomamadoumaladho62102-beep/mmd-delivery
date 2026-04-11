"use client";

import { useState } from "react";

export default function Checkout() {
  const [loading, setLoading] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const pay = async () => {
    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const token =
        typeof window !== "undefined"
          ? localStorage.getItem("sb-access-token")
          : null;

      if (token) headers.Authorization = `Bearer ${token}`;

      const res = await fetch("/api/stripe/client/checkout", {
        method: "POST",
        headers,
        body: JSON.stringify({ order_id: orderId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data?.error || "Checkout failed");
      }

      if (!data?.url) {
        throw new Error("Checkout URL missing");
      }

      window.location.href = data.url;
    } catch (e: any) {
      setError(e?.message || "Error");
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: 24, maxWidth: 500 }}>
      <h2>Paiement test</h2>

      <input
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
        placeholder="Order ID"
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 8,
          border: "1px solid #ddd",
          marginBottom: 12,
        }}
      />

      <button
        onClick={pay}
        disabled={loading || !orderId}
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ddd",
          cursor: "pointer",
        }}
      >
        {loading ? "Redirection..." : "Payer"}
      </button>

      {error && (
        <div style={{ marginTop: 8, color: "crimson" }}>{error}</div>
      )}
    </main>
  );
}
