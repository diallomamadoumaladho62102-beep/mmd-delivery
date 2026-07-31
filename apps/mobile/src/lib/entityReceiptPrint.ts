import {
  formatMoneyFromCents,
  formatDateTime,
  formatDistance,
  formatDurationMinutes,
} from "../i18n/formatters";
import type { EntityReceipt } from "./entityReceiptTypes";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(cents: number, currency: string, language: string) {
  return escapeHtml(formatMoneyFromCents(cents, currency, language));
}

/**
 * Shared HTML builder for food + package receipts (expo-print PDF).
 */
export function buildEntityReceiptHtml(
  receipt: EntityReceipt,
  labels: Record<string, string>,
  language: string,
  entityLabelKey = "order.receipt.order"
): string {
  const currency = receipt.invoice.currency;
  const fareRows = receipt.fare_lines
    .map((line) => {
      const label = escapeHtml(
        labels[line.label_key] ?? line.label_key.split(".").pop() ?? line.key
      );
      const amount = money(line.amount_cents, currency, language);
      return `<tr><td>${label}</td><td class="amt">${amount}</td></tr>`;
    })
    .join("");

  const timelineRows = receipt.financial_timeline
    .map((ev) => {
      const title = escapeHtml(labels[ev.title_key] ?? ev.title_fallback);
      const when = escapeHtml(formatDateTime(ev.occurred_at, language));
      const amount = money(ev.amount_cents, ev.currency || currency, language);
      return `<tr><td>${title}<div class="muted">${when}</div></td><td class="amt">${amount}</td></tr>`;
    })
    .join("");

  const mapBlock = receipt.delivery.map_static_url
    ? `<img class="map" src="${escapeHtml(receipt.delivery.map_static_url)}" alt="" />`
    : "";

  const merchantBlock = receipt.merchant
    ? `<div class="section">
        <h2>${escapeHtml(
          labels[
            receipt.merchant.kind === "package"
              ? "order.receipt.package"
              : "order.receipt.restaurant"
          ] ?? (receipt.merchant.kind === "package" ? "Package" : "Restaurant")
        )}</h2>
        <p><strong>${escapeHtml(receipt.merchant.name)}</strong></p>
      </div>`
    : "";

  const driverBlock = receipt.driver?.name
    ? `<div class="section">
        <h2>${escapeHtml(labels["order.receipt.driver"] ?? "Driver")}</h2>
        <p><strong>${escapeHtml(receipt.driver.name ?? "")}</strong></p>
        <p class="muted">${escapeHtml(
          [receipt.driver.vehicle_label, receipt.driver.plate]
            .filter(Boolean)
            .join(" · ")
        )}</p>
      </div>`
    : "";

  const paymentBits = [
    receipt.payment.brand,
    receipt.payment.last4 ? `•••• ${receipt.payment.last4}` : null,
    receipt.payment.payment_intent_id
      ? `${labels["order.receipt.paymentRef"] ?? "Ref"}: ${receipt.payment.payment_intent_id}`
      : null,
  ]
    .filter(Boolean)
    .map((x) => escapeHtml(String(x)))
    .join("<br/>");

  const duration =
    receipt.delivery.duration_minutes ?? receipt.delivery.eta_minutes;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(receipt.invoice.invoice_number)}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: "Segoe UI", Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; background: #fff; }
  .brand { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: #0f172a; }
  .legal { color: #64748b; font-size: 12px; margin-top: 4px; }
  .header { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 20px; }
  .meta { text-align: right; font-size: 12px; color: #334155; line-height: 1.5; }
  .map { width: 100%; max-height: 220px; object-fit: cover; border-radius: 12px; margin: 12px 0; }
  .section { margin: 18px 0; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin: 0 0 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 0; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; }
  .amt { text-align: right; font-weight: 700; white-space: nowrap; }
  .total { font-size: 16px; font-weight: 800; }
  .muted { color: #64748b; font-size: 11px; font-weight: 400; }
  .support { margin-top: 28px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #475569; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${escapeHtml(receipt.company.brand)}</div>
      <div class="legal">${escapeHtml(receipt.company.legal_name)}</div>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(labels["order.receipt.invoice"] ?? "Invoice")}</strong> ${escapeHtml(receipt.invoice.invoice_number)}</div>
      <div>${escapeHtml(labels[entityLabelKey] ?? "Order")} ${escapeHtml(receipt.invoice.entity_number)}</div>
      <div>${escapeHtml(formatDateTime(receipt.invoice.issued_at, language))}</div>
      <div>${escapeHtml(receipt.invoice.payment_status)}</div>
    </div>
  </div>

  <div class="section">
    <h2>${escapeHtml(labels["order.receipt.delivery"] ?? "Delivery")}</h2>
    ${mapBlock}
    <p><strong>${escapeHtml(labels["order.receipt.pickup"] ?? "Pickup")}</strong><br/>${escapeHtml(receipt.delivery.pickup_address)}</p>
    <p><strong>${escapeHtml(labels["order.receipt.dropoff"] ?? "Dropoff")}</strong><br/>${escapeHtml(receipt.delivery.dropoff_address)}</p>
    <p class="muted">
      ${escapeHtml(formatDistance(receipt.delivery.distance_miles, language))}
      · ${escapeHtml(formatDurationMinutes(duration, language))}
    </p>
  </div>

  ${merchantBlock}
  ${driverBlock}

  <div class="section">
    <h2>${escapeHtml(labels["order.receipt.payment"] ?? "Payment")}</h2>
    <table>
      ${fareRows}
      <tr class="total"><td>${escapeHtml(labels["order.receipt.totalPaid"] ?? "Total paid")}</td><td class="amt">${money(receipt.totals.total_paid_cents, currency, language)}</td></tr>
    </table>
    <p class="muted" style="margin-top:10px">${paymentBits}</p>
  </div>

  ${
    timelineRows
      ? `<div class="section"><h2>${escapeHtml(labels["order.receipt.history"] ?? "Financial history")}</h2><table>${timelineRows}</table></div>`
      : ""
  }

  <div class="support">
    <div>${escapeHtml(labels["order.receipt.support"] ?? "Support")}</div>
    <div>${escapeHtml(receipt.company.support_email)}</div>
    ${receipt.company.support_phone ? `<div>${escapeHtml(receipt.company.support_phone)}</div>` : ""}
    <div>${escapeHtml(receipt.company.support_url)}</div>
    <div class="muted">${escapeHtml(receipt.invoice.invoice_number)}</div>
  </div>
</body>
</html>`;
}

export async function printEntityReceiptPdf(
  receipt: EntityReceipt,
  labels: Record<string, string>,
  language: string,
  entityLabelKey = "order.receipt.order"
) {
  const Print = await import("expo-print");
  const html = buildEntityReceiptHtml(
    receipt,
    labels,
    language,
    entityLabelKey
  );
  await Print.printAsync({ html });
}
