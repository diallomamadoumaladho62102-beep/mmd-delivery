import type {
  DriverIdentitySettings,
  DriverIdentityStateRow,
  DriverIdentityTriggerType,
  IdentityEvaluateContext,
  IdentityTriggerDecision,
} from "@/lib/driverIdentityTypes";

function daysBetween(fromIso: string | null | undefined, to = new Date()): number | null {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return null;
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function hashToRandomThreshold(
  driverId: string,
  settings: DriverIdentitySettings,
): number {
  let hash = 0;
  const seed = `${driverId}:${settings.random_min_rides}:${settings.random_max_rides}`;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const span = settings.random_max_rides - settings.random_min_rides + 1;
  return settings.random_min_rides + (hash % span);
}

export function evaluateIdentityTriggers(input: {
  settings: DriverIdentitySettings;
  state: DriverIdentityStateRow | null;
  context: IdentityEvaluateContext;
  hasOpenReport: boolean;
  isKnownDevice: boolean;
  profileWasSuspended: boolean;
  profilePhotoChangedRecently: boolean;
  phoneChangedRecently: boolean;
  pendingPostSuspensionCheck: boolean;
}): IdentityTriggerDecision | null {
  const { settings, state, context, hasOpenReport, isKnownDevice } = input;
  const decisions: IdentityTriggerDecision[] = [];

  const push = (
    triggerType: DriverIdentityTriggerType,
    reason: string,
    riskScore: number,
    requiresManualReview = false,
  ) => {
    decisions.push({ triggerType, reason, riskScore, requiresManualReview });
  };

  if (context.intent === "admin" && context.adminUserId) {
    push(
      "admin_manual",
      context.adminReason?.trim() || "Administrative identity verification requested.",
      90,
      true,
    );
  }

  if (hasOpenReport && settings.require_on_report) {
    push("client_report", "A client report requires identity confirmation.", 75, true);
  }

  if (settings.require_on_first_online && !state?.last_verified_at) {
    push("first_online", "First time going online requires identity verification.", 40, false);
  }

  if (
    settings.require_after_suspension &&
    input.pendingPostSuspensionCheck
  ) {
    push("post_suspension", "Account was suspended — identity must be reconfirmed.", 85, true);
  }

  if (settings.require_on_new_device && context.deviceIdHash && !isKnownDevice) {
    push("new_device", "New device detected.", 55, false);
  }

  if (
    settings.require_on_city_change &&
    context.city &&
    state?.last_city &&
    context.city.trim().toLowerCase() !== state.last_city.trim().toLowerCase()
  ) {
    push("city_change", `New city detected (${context.city}).`, 50, false);
  }

  if (
    settings.require_on_country_change &&
    context.country &&
    state?.last_country &&
    context.country.trim().toUpperCase() !== state.last_country.trim().toUpperCase()
  ) {
    push("country_change", `New country detected (${context.country}).`, 70, true);
  }

  const inactiveDays = daysBetween(state?.last_online_at);
  if (
    settings.require_after_inactivity_days > 0 &&
    inactiveDays != null &&
    inactiveDays >= settings.require_after_inactivity_days
  ) {
    push(
      "inactivity",
      `Inactive for ${inactiveDays} days (threshold ${settings.require_after_inactivity_days}).`,
      45,
      false,
    );
  }

  if (settings.periodic_check_enabled && state?.last_verified_at) {
    const sinceVerify = daysBetween(state.last_verified_at);
    if (sinceVerify != null && sinceVerify >= settings.periodic_check_days) {
      push(
        "periodic",
        `Periodic verification due (${sinceVerify} days since last verification).`,
        35,
        false,
      );
    }
  }

  if (input.profilePhotoChangedRecently && settings.require_on_profile_photo_change) {
    push("profile_photo_change", "Profile photo was updated.", 60, true);
  }

  if (input.phoneChangedRecently && settings.require_on_phone_change) {
    push("phone_change", "Phone number was updated.", 65, true);
  }

  if (settings.random_check_enabled && state?.last_verified_at) {
    const threshold =
      state.next_random_ride_threshold ??
      hashToRandomThreshold(context.driverId, settings);
    if ((state.rides_since_verification ?? 0) >= threshold) {
      push(
        "random",
        "Routine random identity verification.",
        30,
        false,
      );
    }
  }

  if (decisions.length === 0) return null;

  decisions.sort((a, b) => b.riskScore - a.riskScore);
  const top = decisions[0];

  if (
    settings.manual_review_enabled &&
    top.riskScore >= Number(settings.manual_review_risk_threshold)
  ) {
    top.requiresManualReview = true;
  }

  return top;
}

export function computeVerificationExpiry(
  settings: DriverIdentitySettings,
  from = new Date(),
): string {
  const d = new Date(from);
  d.setDate(d.getDate() + settings.verification_validity_days);
  return d.toISOString();
}

export function hashIp(ip: string | null | undefined): string | null {
  const clean = String(ip ?? "").trim();
  if (!clean) return null;
  let hash = 2166136261;
  for (let i = 0; i < clean.length; i += 1) {
    hash ^= clean.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `ip_${(hash >>> 0).toString(16)}`;
}
