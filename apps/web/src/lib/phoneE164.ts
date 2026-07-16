/** Default region for bare 10-digit US numbers stored without country code. */
const DEFAULT_US_COUNTRY_CODE = "1";

/**
 * Normalize a phone number to E.164 when possible.
 * US numbers stored as 10 digits (e.g. 9297408722) become +19297408722.
 */
export function normalizePhoneE164(
  phone: string | null | undefined,
): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;

  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;

  if (digits.startsWith("+")) {
    const normalized = `+${digits.slice(1).replace(/\D/g, "")}`;
    return normalized.length > 1 ? normalized : null;
  }

  const onlyDigits = digits.replace(/\D/g, "");
  if (!onlyDigits) return null;

  if (onlyDigits.length === 10) {
    return `+${DEFAULT_US_COUNTRY_CODE}${onlyDigits}`;
  }

  if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) {
    return `+${onlyDigits}`;
  }

  if (raw.startsWith("+")) {
    return `+${onlyDigits}`;
  }

  return `+${onlyDigits}`;
}

export function phonesEquivalent(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const left = normalizePhoneE164(a);
  const right = normalizePhoneE164(b);
  if (!left || !right) return false;
  return left === right;
}

export function maskPhone(phone: string | null | undefined): string {
  const normalized = normalizePhoneE164(phone);
  if (!normalized) return "(hidden)";
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return "(hidden)";
  return `***${digits.slice(-4)}`;
}
