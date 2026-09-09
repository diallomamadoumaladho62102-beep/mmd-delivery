/**
 * Display mapping for restaurant cuisine_type values.
 * Stored DB strings stay unchanged; only the label shown to the user is localized.
 */
type Translate = (key: string) => string;

export function cuisineTypeSlug(raw: string): string {
  return String(raw || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function localizedCuisineType(
  t: Translate,
  raw: string | null | undefined,
): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  const slug = cuisineTypeSlug(value);
  if (!slug) return value;
  const key = `client.restaurants.cuisine.${slug}`;
  const translated = t(key);
  if (!translated || translated === key) return value;
  return translated;
}
