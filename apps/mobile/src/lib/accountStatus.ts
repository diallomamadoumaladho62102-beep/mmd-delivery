export type AccountStatus = "active" | "suspended" | "disabled";

export function normalizeAccountStatus(
  value: string | null | undefined
): AccountStatus {
  const clean = String(value ?? "active").trim().toLowerCase();
  if (clean === "suspended" || clean === "disabled") return clean;
  return "active";
}

export function isAccountActive(status: string | null | undefined): boolean {
  const clean = String(status ?? "").trim().toLowerCase();
  if (!clean || clean === "unknown") return false;
  return normalizeAccountStatus(status) === "active";
}

export function accountStatusBlockMessage(
  status: string | null | undefined
): string | null {
  const normalized = normalizeAccountStatus(status);
  if (normalized === "suspended") {
    return "Votre compte est suspendu. Contactez le support MMD Delivery.";
  }
  if (normalized === "disabled") {
    return "Votre compte est désactivé. Contactez le support MMD Delivery.";
  }
  if (String(status ?? "").trim().toLowerCase() === "unknown") {
    return "Impossible de vérifier le statut du compte. Réessaie dans un instant.";
  }
  return null;
}

export function isDriverDispatchEligible(
  status: string | null | undefined
): boolean {
  return String(status ?? "").trim().toLowerCase() === "approved";
}

export function driverOnlineBlockMessage(
  status: string | null | undefined
): string | null {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (normalized === "suspended") {
    return "Ton compte chauffeur est suspendu. Contacte le support MMD Delivery.";
  }
  if (normalized === "disabled") {
    return "Ton compte chauffeur est désactivé. Contacte le support MMD Delivery.";
  }
  if (normalized !== "approved") {
    return "Ton profil chauffeur doit être approuvé avant de passer en ligne.";
  }
  return null;
}

export function isDriverOnlineEligible(
  status: string | null | undefined
): boolean {
  return driverOnlineBlockMessage(status) === null;
}

export function isRestaurantOrderEligible(
  status: string | null | undefined
): boolean {
  return String(status ?? "").trim().toLowerCase() === "approved";
}
