"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

type Receipt = {
  company: {
    brand: string;
    legal_name: string;
    support_email: string;
    support_phone: string | null;
    support_url: string;
  };
  invoice: {
    invoice_number: string;
    ride_number: string;
    payment_status: string;
    currency: string;
    issued_at: string;
  };
  trip: {
    pickup_address: string;
    dropoff_address: string;
    map_static_url: string | null;
  };
  fare_lines: Array<{ key: string; label_key: string; amount_cents: number }>;
  totals: { total_paid_cents: number };
};

const LABELS: Record<string, Record<string, string>> = {
  en: {
    trip: "Trip",
    pickup: "Pickup",
    dropoff: "Dropoff",
    payment: "Payment",
    totalPaid: "Total paid",
    signIn: "Sign in to view this receipt.",
    loading: "Loading receipt…",
  },
  fr: {
    trip: "Trajet",
    pickup: "Départ",
    dropoff: "Arrivée",
    payment: "Paiement",
    totalPaid: "Total payé",
    signIn: "Connectez-vous pour voir ce reçu.",
    loading: "Chargement du reçu…",
  },
};

function pickLabels(lang: string) {
  const code = lang.toLowerCase().startsWith("fr") ? "fr" : "en";
  return LABELS[code];
}

/**
 * Authenticated web view of a taxi receipt (QR target).
 * Data comes exclusively from GET /api/taxi/rides/:id/receipt.
 */
export default function TaxiReceiptWebPage() {
  const params = useParams<{ id: string }>();
  const rideId = String(params?.id ?? "").trim();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const labels = useMemo(
    () =>
      pickLabels(
        typeof navigator !== "undefined" ? navigator.language : "en"
      ),
    []
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setError(labels.signIn);
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/taxi/rides/${rideId}/receipt`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String(json.error ?? `HTTP ${res.status}`));
        }
        if (!cancelled) setReceipt(json.receipt as Receipt);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load receipt");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId, labels.signIn]);

  if (loading) {
    return (
      <main style={{ padding: 24, color: "#64748b" }}>{labels.loading}</main>
    );
  }
  if (error || !receipt) {
    return (
      <main style={{ padding: 24, color: "#b91c1c" }} role="alert">
        {error ?? "Not found"}
      </main>
    );
  }

  const currency = receipt.invoice.currency;
  const fmt = (cents: number) =>
    new Intl.NumberFormat(
      typeof navigator !== "undefined" ? navigator.language : "en-US",
      { style: "currency", currency }
    ).format((Number(cents) || 0) / 100);

  return (
    <main
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: 24,
        fontFamily: "Segoe UI, Helvetica, Arial, sans-serif",
        color: "#0f172a",
      }}
    >
      <header
        style={{
          borderBottom: "2px solid #0f172a",
          paddingBottom: 16,
          marginBottom: 20,
        }}
      >
        <div style={{ fontSize: 28, fontWeight: 800 }}>{receipt.company.brand}</div>
        <div style={{ color: "#64748b" }}>{receipt.company.legal_name}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          {receipt.invoice.invoice_number}
        </div>
        <div style={{ fontSize: 13 }}>
          {receipt.invoice.ride_number} · {receipt.invoice.payment_status}
        </div>
      </header>

      {receipt.trip.map_static_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={receipt.trip.map_static_url}
          alt=""
          style={{ width: "100%", borderRadius: 12, marginBottom: 16 }}
        />
      ) : null}

      <section>
        <h2
          style={{
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          {labels.trip}
        </h2>
        <p>
          <strong>{labels.pickup}</strong>
          <br />
          {receipt.trip.pickup_address}
        </p>
        <p>
          <strong>{labels.dropoff}</strong>
          <br />
          {receipt.trip.dropoff_address}
        </p>
      </section>

      <section>
        <h2
          style={{
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          {labels.payment}
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {receipt.fare_lines.map((line) => (
              <tr key={line.key}>
                <td style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
                  {line.key}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    fontWeight: 700,
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  {fmt(line.amount_cents)}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800 }}>
              <td style={{ paddingTop: 10 }}>{labels.totalPaid}</td>
              <td style={{ textAlign: "right", paddingTop: 10 }}>
                {fmt(receipt.totals.total_paid_cents)}
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <footer
        style={{
          marginTop: 28,
          paddingTop: 14,
          borderTop: "1px solid #e2e8f0",
          fontSize: 12,
          color: "#475569",
        }}
      >
        <div>{receipt.company.support_email}</div>
        {receipt.company.support_phone ? (
          <div>{receipt.company.support_phone}</div>
        ) : null}
        <div>{receipt.company.support_url}</div>
      </footer>
    </main>
  );
}
