export type MarketCountry = "GN" | "US";

export function isMarketCountry(value: unknown): value is MarketCountry {
  const code = String(value ?? "").trim().toUpperCase();
  return code === "GN" || code === "US";
}

export function asMarketCountry(value: unknown): MarketCountry | null {
  const code = String(value ?? "").trim().toUpperCase();
  return isMarketCountry(code) ? code : null;
}

export function marketPhonePrefix(country: MarketCountry): "+224" | "+1" {
  return country === "GN" ? "+224" : "+1";
}

export function marketCurrency(country: MarketCountry): "GNF" | "USD" {
  return country === "GN" ? "GNF" : "USD";
}

/** US signup keeps its postal requirement. Guinea does not invent a postal code. */
export function marketRequiresPostalCode(country: MarketCountry): boolean {
  return country === "US";
}

export function normalizeGuineaPhone(value: string): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const compact = raw.replace(/[^\d+]/g, "");
  if (compact.startsWith("+")) return compact;
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("224") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 9) return `+224${digits}`;
  return compact;
}

export function isPlausibleGuineaPhone(value: string): boolean {
  return /^\+224\d{8,9}$/.test(String(value ?? "").trim());
}
