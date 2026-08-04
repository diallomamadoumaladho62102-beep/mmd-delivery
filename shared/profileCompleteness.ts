/**
 * Shared client (and future role) profile completeness scoring.
 * Used by Admin CRM, mobile gates, and web client banners.
 */

export type ProfileCompletenessInput = {
  fullName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
  phone?: string | null;
  phoneVerified?: boolean | null;
  avatarUrl?: string | null;
  addressLine?: string | null;
  city?: string | null;
  /** True when Mapbox (or equivalent) produced coordinates. */
  addressVerified?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type ProfileCompletenessResult = {
  percent: number;
  missing: string[];
  status: "complete" | "incomplete";
  checks: Record<string, boolean>;
};

function nonEmpty(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function hasCoords(input: ProfileCompletenessInput): boolean {
  if (input.addressVerified === true) return true;
  const lat = Number(input.latitude);
  const lng = Number(input.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng);
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", last: "" };
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * Weighted completeness for client accounts.
 * New accounts should reach 100% before full platform access when gates are on.
 */
export function scoreClientProfileCompleteness(
  input: ProfileCompletenessInput,
): ProfileCompletenessResult {
  const fromFull = splitName(String(input.fullName ?? ""));
  const first = String(input.firstName ?? "").trim() || fromFull.first;
  const last = String(input.lastName ?? "").trim() || fromFull.last;
  const phone = String(input.phone ?? "").trim();
  const addressLine = String(input.addressLine ?? "").trim();
  const city = String(input.city ?? "").trim();
  const avatar = String(input.avatarUrl ?? "").trim();

  const checks: Record<string, boolean> = {
    first_name: nonEmpty(first),
    last_name: nonEmpty(last),
    email: nonEmpty(input.email),
    email_verified: input.emailVerified === true,
    phone: phone.replace(/\D/g, "").length >= 7,
    phone_verified: input.phoneVerified === true,
    avatar: nonEmpty(avatar),
    address: nonEmpty(addressLine),
    city: nonEmpty(city),
    address_verified: hasCoords(input) && nonEmpty(addressLine),
  };

  const weights: Record<keyof typeof checks, number> = {
    first_name: 10,
    last_name: 10,
    email: 10,
    email_verified: 15,
    phone: 10,
    phone_verified: 15,
    avatar: 10,
    address: 10,
    city: 5,
    address_verified: 5,
  };

  let earned = 0;
  let total = 0;
  const missing: string[] = [];
  for (const key of Object.keys(checks) as (keyof typeof checks)[]) {
    total += weights[key];
    if (checks[key]) earned += weights[key];
    else missing.push(key);
  }

  const percent = total === 0 ? 0 : Math.round((earned / total) * 100);
  return {
    percent,
    missing,
    status: percent >= 100 ? "complete" : "incomplete",
    checks,
  };
}

/** Soft gate helper for existing accounts (do not hard-block when flags off). */
export function isClientProfileComplete(
  input: ProfileCompletenessInput,
  opts?: { requirePhoneVerified?: boolean; requireEmailVerified?: boolean },
): boolean {
  const score = scoreClientProfileCompleteness(input);
  if (score.percent < 100) {
    // Legacy soft complete: name + phone + address + avatar (matches historical mobile gate)
    const soft =
      score.checks.first_name &&
      score.checks.phone &&
      score.checks.address &&
      score.checks.avatar;
    if (!opts?.requirePhoneVerified && !opts?.requireEmailVerified) {
      return soft;
    }
  }
  if (opts?.requireEmailVerified && !score.checks.email_verified) return false;
  if (opts?.requirePhoneVerified && !score.checks.phone_verified) return false;
  return score.status === "complete";
}
