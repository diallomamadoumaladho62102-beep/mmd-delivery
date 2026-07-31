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
    entity_number: string;
    payment_status: string;
    currency: string;
    issued_at: string;
  };
  delivery: {
    pickup_address: string;
    dropoff_address: string;
    map_static_url: string | null;
    distance_miles: number | null;
    duration_minutes: number | null;
    eta_minutes: number | null;
  };
  merchant: {
    kind: string;
    name: string;
    photo_url: string | null;
  } | null;
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

export default function DeliveryRequestReceiptWebPage() {
  const params = useParams<{ id: string }>();
  const requestId = String(params?.id ?? "").trim();
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
          setError(t("order.receipt.signIn"));
          setLoading(false);
          return;
        }

        const res = await fetch(`/api/delivery-requests/${requestId}/receipt`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(String(json.error ?? t("order.receipt.loadFailed")));
        }
        if (!cancelled) setReceipt(json.receipt as Receipt);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : t("order.receipt.loadFailed")
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId, t]);

  if (loading) {
    return (
      <main style={{ padding: 24, color: "#64748b" }} dir={dir} aria-busy="true">
        {t("order.receipt.loading")}
      </main>
    );
  }

  if (error || !receipt) {
    return (
      <main style={{ padding: 24, color: "#b91c1c" }} role="alert" dir={dir}>
        {error ?? t("order.receipt.notFound")}
      </main>
    );
  }

  const currency = receipt.invoice.currency;
  const money = (cents: number) => formatMoneyFromCents(cents, currency, locale);
  const tripMeta = [
    formatDistance(receipt.delivery.distance_miles, locale),
    formatDurationMinutes(
      receipt.delivery.duration_minutes ?? receipt.delivery.eta_minutes,
      locale
    ),
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
          {t("order.receipt.invoice")} {receipt.invoice.invoice_number}
        </div>
        <div style={{ fontSize: 13 }}>
          {t("order.receipt.package")} {receipt.invoice.entity_number} ·{" "}
          {receipt.invoice.payment_status}
        </div>
        <div style={{ fontSize: 13, color: "#64748b" }}>
          {formatDateTime(receipt.invoice.issued_at, locale)}
        </div>
      </header>

      <section>
        <h2
          style={{
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          {t("order.receipt.delivery")}
        </h2>
        {receipt.delivery.map_static_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={receipt.delivery.map_static_url}
            alt={t("order.receipt.tripMap")}
            style={{
              width: "100%",
              borderRadius: 12,
              marginBottom: 16,
              background: "#f1f5f9",
            }}
          />
        ) : null}
        <p>
          <strong>{t("order.receipt.pickup")}</strong>
          <br />
          {receipt.delivery.pickup_address}
        </p>
        <p>
          <strong>{t("order.receipt.dropoff")}</strong>
          <br />
          {receipt.delivery.dropoff_address}
        </p>
        {tripMeta ? (
          <p style={{ color: "#64748b", fontSize: 13 }}>{tripMeta}</p>
        ) : null}
      </section>

      {receipt.merchant ? (
        <section style={{ marginTop: 20 }}>
          <h2
            style={{
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {t("order.receipt.package")}
          </h2>
          <p style={{ fontWeight: 700 }}>{receipt.merchant.name}</p>
        </section>
      ) : null}

      {receipt.driver?.name ? (
        <section style={{ marginTop: 20 }}>
          <h2
            style={{
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {t("order.receipt.driver")}
          </h2>
          <p style={{ fontWeight: 700 }}>{receipt.driver.name}</p>
        </section>
      ) : null}

      <section style={{ marginTop: 20 }}>
        <h2
          style={{
            fontSize: 12,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#64748b",
          }}
        >
          {t("order.receipt.payment")}
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {receipt.fare_lines.map((line) => (
              <tr key={line.key}>
                <td style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
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
              <td style={{ paddingTop: 10 }}>{t("order.receipt.totalPaid")}</td>
              <td style={{ textAlign: "right", paddingTop: 10 }}>
                {money(receipt.totals.total_paid_cents)}
              </td>
            </tr>
          </tbody>
        </table>
        <p style={{ color: "#64748b", fontSize: 12, marginTop: 10 }}>
          {[
            receipt.payment.method === "business_wallet"
              ? t("order.receipt.businessWallet")
              : t("order.receipt.card"),
            receipt.payment.brand,
            receipt.payment.last4 ? `•••• ${receipt.payment.last4}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {receipt.payment.payment_intent_id ? (
          <p style={{ color: "#64748b", fontSize: 12 }}>
            {t("order.receipt.paymentRef")}: {receipt.payment.payment_intent_id}
          </p>
        ) : null}
      </section>

      {receipt.financial_timeline?.length > 0 ? (
        <section style={{ marginTop: 20 }}>
          <h2
            style={{
              fontSize: 12,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            {t("order.receipt.history")}
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {receipt.financial_timeline.map((ev) => (
                <tr key={ev.id}>
                  <td style={{ padding: "8px 0", borderBottom: "1px solid #e2e8f0" }}>
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
        <div>{t("order.receipt.support")}</div>
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
          <a href={receipt.company.support_url}>{t("order.receipt.helpCenter")}</a>
        </div>
      </footer>
    </main>
  );
}
