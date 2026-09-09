/**
 * Filter taxi offers that are past expires_at.
 */

import i18n from "i18next";

function tr(
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>,
): string {
  try {
    const value = i18n.t(key, { defaultValue, ...options });
    return typeof value === "string" && value.trim() ? value : defaultValue;
  } catch {
    return defaultValue;
  }
}

export type ExpirableOffer = {
  id: string;
  expires_at?: string | null;
};

export function isTaxiOfferExpired(
  offer: ExpirableOffer,
  nowMs: number = Date.now()
): boolean {
  if (!offer.expires_at) return false;
  const expires = new Date(offer.expires_at).getTime();
  if (!Number.isFinite(expires)) return false;
  return expires <= nowMs;
}

export function filterActiveTaxiOffers<T extends ExpirableOffer>(
  offers: T[],
  nowMs: number = Date.now()
): T[] {
  return offers.filter((offer) => !isTaxiOfferExpired(offer, nowMs));
}

export function formatOfferCountdown(
  expiresAt: string,
  nowMs: number = Date.now()
): string {
  const remainingMs = new Date(expiresAt).getTime() - nowMs;
  if (remainingMs <= 0) {
    return tr("taxi.offer.expired", "Expired");
  }
  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds < 60) {
    return tr("taxi.offer.secondsLeft", `${totalSeconds}s left`, {
      count: totalSeconds,
    });
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return tr(
    "taxi.offer.minutesLeft",
    `${minutes}m ${seconds}s left`,
    { minutes, seconds },
  );
}
