import { tryGetServerMapboxToken } from "@/lib/mapboxToken";

export function receiptSiteBaseUrl(): string {
  return (
    String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/$/, "") ||
    "https://www.mmddelivery.com"
  );
}

export function receiptSupportEmail(): string {
  return (
    String(process.env.MMD_SUPPORT_EMAIL ?? "").trim() ||
    "support@mmddelivery.com"
  );
}

export function receiptSupportPhone(): string | null {
  const phone = String(process.env.MMD_ADMIN_SUPPORT_PHONE ?? "").trim();
  return phone || null;
}

export function receiptSupportUrl(): string {
  const explicit = String(process.env.NEXT_PUBLIC_SUPPORT_URL ?? "").trim();
  if (explicit) return explicit;
  return `${receiptSiteBaseUrl()}/legal/support`;
}

export function receiptCompanyBlock() {
  return {
    legal_name: "MMD Delivery LLC",
    brand: "MMD",
    support_email: receiptSupportEmail(),
    support_phone: receiptSupportPhone(),
    support_url: receiptSupportUrl(),
  };
}

export function receiptInvoiceNumber(
  prefix: "TX" | "FD" | "PK",
  entityId: string,
  paidAt: string | null
): string {
  const day = (paidAt ? new Date(paidAt) : new Date())
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const short = entityId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `MMD-${prefix}-${day}-${short}`;
}

/** Prefer cents columns; fall back to dollar columns. */
export function moneyFieldToCents(
  centsField: unknown,
  dollarsField?: unknown
): number {
  const cents = Number(centsField);
  if (Number.isFinite(cents) && Math.abs(cents) > 0) {
    return Math.round(cents);
  }
  const dollars = Number(dollarsField);
  if (Number.isFinite(dollars) && Math.abs(dollars) > 0) {
    return Math.round(dollars * 100);
  }
  if (Number.isFinite(cents)) return Math.round(cents);
  if (Number.isFinite(dollars)) return Math.round(dollars * 100);
  return 0;
}

export function buildPickupDropoffMapStaticUrl(row: Record<string, unknown>): string | null {
  const pickLng = Number(row.pickup_lng ?? row.pickup_longitude);
  const pickLat = Number(row.pickup_lat ?? row.pickup_latitude);
  const dropLng = Number(row.dropoff_lng ?? row.dropoff_longitude);
  const dropLat = Number(row.dropoff_lat ?? row.dropoff_latitude);
  if (![pickLng, pickLat, dropLng, dropLat].every((n) => Number.isFinite(n))) {
    return null;
  }
  const token = tryGetServerMapboxToken();
  if (!token) return null;
  const path = [
    `pin-s-a+0ea5e9(${pickLng},${pickLat})`,
    `pin-s-b+f59e0b(${dropLng},${dropLat})`,
  ].join(",");
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${path}/auto/800x400@2x?access_token=${encodeURIComponent(token)}`;
}

export type ReceiptFareLine = {
  key: string;
  label_key: string;
  amount_cents: number;
  kind: "charge" | "discount" | "info";
};

export function pushFareLine(
  lines: ReceiptFareLine[],
  key: string,
  labelKey: string,
  amountCents: number,
  kind: ReceiptFareLine["kind"] = "charge"
) {
  if (!Number.isFinite(amountCents) || amountCents === 0) return;
  lines.push({
    key,
    label_key: labelKey,
    amount_cents: kind === "discount" ? -Math.abs(amountCents) : amountCents,
    kind,
  });
}
