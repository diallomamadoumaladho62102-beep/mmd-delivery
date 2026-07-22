/**
 * Pure helpers for client-home advertisement scheduling filters.
 */
export function isAdvertisementLiveNow(input: {
  is_active: boolean;
  start_date?: string | null;
  end_date?: string | null;
  nowIso?: string;
}): boolean {
  if (!input.is_active) return false;
  const now = input.nowIso ?? new Date().toISOString();
  if (input.start_date && String(input.start_date) > now) return false;
  if (input.end_date && String(input.end_date) < now) return false;
  return true;
}

export function matchesAdvertisementGeo(input: {
  adCountry?: string | null;
  adCity?: string | null;
  adLanguage?: string | null;
  country?: string | null;
  city?: string | null;
  language?: string | null;
}): boolean {
  if (
    input.adCountry &&
    input.country &&
    String(input.adCountry).toLowerCase() !== String(input.country).toLowerCase()
  ) {
    return false;
  }
  if (
    input.adCity &&
    input.city &&
    String(input.adCity).toLowerCase() !== String(input.city).toLowerCase()
  ) {
    return false;
  }
  if (
    input.adLanguage &&
    input.language &&
    String(input.adLanguage).toLowerCase() !== String(input.language).toLowerCase()
  ) {
    return false;
  }
  return true;
}
