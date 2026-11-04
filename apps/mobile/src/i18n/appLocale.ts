const ALLOWED = new Set(["en", "fr", "es", "ar", "zh", "ff"]);

export function normalizeAppLocale(locale: string): string {
  const raw = String(locale ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  const base = raw.split("-")[0] ?? "en";

  if (base.startsWith("zh")) return "zh";
  if (base.startsWith("ar")) return "ar";
  if (base.startsWith("es")) return "es";
  if (base.startsWith("en")) return "en";
  if (base.startsWith("fr")) return "fr";
  if (base === "ff" || base === "fuc" || base === "fuf" || base === "pul") return "ff";

  return base;
}

export function ensureAppLocale(locale: string): string {
  const normalized = normalizeAppLocale(locale);
  return ALLOWED.has(normalized) ? normalized : "en";
}
