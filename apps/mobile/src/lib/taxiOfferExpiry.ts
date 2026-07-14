/**
 * Filter taxi offers that are past expires_at.
 */

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
  if (remainingMs <= 0) return "Expired";
  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s left`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s left`;
}
