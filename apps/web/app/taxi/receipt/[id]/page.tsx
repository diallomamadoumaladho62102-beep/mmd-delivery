"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";
import { useWebI18n } from "@/components/WebI18nProvider";
import {
  formatDateTime,
  formatDistance,
  formatDurationMinutes,
  formatMoneyFromCents,
} from "@/i18n/formatters";

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
    distance_miles: number | null;
    duration_minutes: number | null;
    wait_fee_minutes: number | null;
    vehicle_category: string | null;
  };
  driver: {
    name: string | null;
    vehicle_label: string | null;
    plate: string | null;
  } | null;
  fare_lines: Array<{ key: string; label_key: string; amount_cents: number }>;
  totals: { total_paid_cents: number };
  payment: {
    method: string;
    brand: string | null;
    last4: string | null;
    payment_intent_id: string | null;
    status: string;
  };
  financial_timeline: Array<{
    id: string;
    title_key: string;
    title_fallback: string;
    status: string;
    amount_cents: number;
    currency: string;
    occurred_at: string;
    subtitle?: string | null;
  }>;
};

/**
 * Authenticated web view of a taxi receipt (QR target).
 * Uses the global WebI18n store + shared formatters (same keys as mobile).
 */
export default function TaxiReceiptWebPage() {
  const params = useParams<{ id: string }>();
  const rideId = String(params?.id ?? "").trim();
  const { t, locale, dir } = useWebI18n();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) {
          setError(t("taxi.receipt.signIn"));
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/taxi/rides/${rideId}/receipt`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            String(json.error ?? t("taxi.receipt.loadFailed"))
          );
        }
        if (!cancelled) setReceipt(json.receipt as Receipt);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : t("taxi.receipt.loadFailed")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rideId, t]);

  if (loading) {
    return (
      <main
        style={{ padding: 24, color: "#64748b" }}
        dir={dir}
        aria-busy="true"
        aria-live="polite"
      >
        {t("taxi.receipt.loading")}
      </main>
    );
  }

  if (error || !receipt) {
    return (
      <main style={{ padding: 24, color: "#b91c1c" }} role="alert" dir={dir}>
        {error ?? t("taxi.receipt.notFound")}
      </main>
    );
  }

  const currency = receipt.invoice.currency;
  const money = (cents: number) =>
    formatMoneyFromCents(cents, currency, locale);

  const tripMeta = [
    formatDistance(receipt.trip.distance_miles, locale),
    formatDurationMinutes(receipt.trip.duration_minutes, locale),
    receipt.trip.wait_fee_minutes
      ? `${t("taxi.receipt.wait")} ${formatDurationMinutes(receipt.trip.wait_fee_minutes, locale)}`
      : null,
    receipt.trip.vehicle_category,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main
      dir={dir}
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
          {t("taxi.receipt.invoice")} {receipt.invoice.invoice_number}
        </div>
        <div style={{ fontSize: 13 }}>
          {t("taxi.receipt.ride")} {receipt.invoice.ride_number} ·{" "}
          {receipt.invoice.payment_status}
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          {formatDateTime(receipt.invoice.issued_at, locale)}
        </div>
      </header>

      <section aria-labelledby="trip-heading">
        <h2
          id="trip-heading"
          style={{
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          {t("taxi.receipt.trip")}
        </h2>
        {receipt.trip.map_static_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={receipt.trip.map_static_url}
            alt={t("taxi.receipt.tripMap")}
            style={{
              width: "100%",
              borderRadius: 12,
              marginBottom: 16,
              background: "#f1f5f9",
            }}
          />
        ) : (
          <div
            role="status"
            style={{
              padding: 16,
              borderRadius: 12,
              background: "#f1f5f9",
              color: "#64748b",
              marginBottom: 16,
              fontSize: 13,
            }}
          >
            {t("taxi.receipt.mapUnavailable")}
          </div>
        )}
        <p>
          <strong>{t("taxi.receipt.pickup")}</strong>
          <br />
          {receipt.trip.pickup_address}
        </p>
        <p>
          <strong>{t("taxi.receipt.dropoff")}</strong>
          <br />
          {receipt.trip.dropoff_address}
        </p>
        {tripMeta ? (
          <p style={{ color: "#64748b", fontSize: 13 }}>{tripMeta}</p>
        ) : null}
      </section>

      {receipt.driver ? (
        <section aria-labelledby="driver-heading" style={{ marginTop: 20 }}>
          <h2
            id="driver-heading"
            style={{
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {t("taxi.receipt.driver")}
          </h2>
          <p style={{ fontWeight: 700 }}>{receipt.driver.name}</p>
          <p style={{ color: "#64748b", fontSize: 13 }}>
            {[receipt.driver.vehicle_label, receipt.driver.plate]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </section>
      ) : null}

      <section aria-labelledby="payment-heading" style={{ marginTop: 20 }}>
        <h2
          id="payment-heading"
          style={{
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          {t("taxi.receipt.payment")}
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {receipt.fare_lines.map((line) => (
              <tr key={line.key}>
                <td
                  style={{
                    padding: "8px 0",
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  {t(line.label_key)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    fontWeight: 700,
                    borderBottom: "1px solid #e2e8f0",
                  }}
                >
                  {money(line.amount_cents)}
                </td>
              </tr>
            ))}
            <tr style={{ fontWeight: 800 }}>
              <td style={{ paddingTop: 10 }}>{t("taxi.receipt.totalPaid")}</td>
              <td style={{ textAlign: "right", paddingTop: 10 }}>
                {money(receipt.totals.total_paid_cents)}
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ color: "#64748b", fontSize: 12, marginTop: 10 }}>
          {[
            receipt.payment.method === "business_wallet"
              ? t("taxi.receipt.businessWallet")
              : t("taxi.receipt.card"),
            receipt.payment.brand,
            receipt.payment.last4 ? `•••• ${receipt.payment.last4}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {receipt.payment.payment_intent_id ? (
          <p style={{ color: "#64748b", fontSize: 12 }}>
            {t("taxi.receipt.paymentRef")}: {receipt.payment.payment_intent_id}
          </p>
        ) : null}
      </section>

      {receipt.financial_timeline?.length > 0 ? (
        <section aria-labelledby="history-heading" style={{ marginTop: 20 }}>
          <h2
            id="history-heading"
            style={{
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {t("taxi.receipt.history")}
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {receipt.financial_timeline.map((ev) => (
                <tr key={ev.id}>
                  <td
                    style={{
                      padding: "8px 0",
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    {t(ev.title_key) !== ev.title_key
                      ? t(ev.title_key)
                      : ev.title_fallback}
                    <div style={{ color: "#64748b", fontSize: 11 }}>
                      {formatDateTime(ev.occurred_at, locale)} · {ev.status}
                    </div>
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontWeight: 700,
                      borderBottom: "1px solid #e2e8f0",
                    }}
                  >
                    {formatMoneyFromCents(
                      ev.amount_cents,
                      ev.currency || currency,
                      locale
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <footer
        style={{
          marginTop: 28,
          paddingTop: 14,
          borderTop: "1px solid #e2e8f0",
          fontSize: 12,
          color: "#475569",
        }}
      >
        <div>{t("taxi.receipt.support")}</div>
        <div>
          <a href={`mailto:${receipt.company.support_email}`}>
            {receipt.company.support_email}
          </a>
        </div>
        {receipt.company.support_phone ? (
          <div>
            <a href={`tel:${receipt.company.support_phone}`}>
              {receipt.company.support_phone}
            </a>
          </div>
        ) : null}
        <div>
          <a href={receipt.company.support_url}>{t("taxi.receipt.helpCenter")}</a>
        </div>
      </footer>
    </main>
  );
}
