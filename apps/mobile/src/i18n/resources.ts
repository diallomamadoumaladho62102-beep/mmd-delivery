// apps/mobile/src/i18n/resources.ts
// ✅ i18n resources viennent des JSON (1 source de vérité)
// ✅ On garde seulement les 6 langues autorisées : en, fr, es, ar, zh, ff

import enCommon from "./locales/en/common.json";
import frCommon from "./locales/fr/common.json";
import esCommon from "./locales/es/common.json";
import arCommon from "./locales/ar/common.json";
import zhCommon from "./locales/zh/common.json";
import ffCommon from "./locales/ff/common.json";

import enExtras from "./locales/en/extras.json";
import frExtras from "./locales/fr/extras.json";
import esExtras from "./locales/es/extras.json";
import arExtras from "./locales/ar/extras.json";
import zhExtras from "./locales/zh/extras.json";
import ffExtras from "./locales/ff/extras.json";

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isObject(base)) return override ?? base;
  const out: Record<string, unknown> = { ...base };
  if (!isObject(override)) return out;

  for (const k of Object.keys(override)) {
    const bv = out[k];
    const ov = override[k];
    if (isObject(bv) && isObject(ov)) out[k] = deepMerge(bv, ov);
    else out[k] = ov;
  }
  return out;
}

function buildTranslation(common: unknown, extras: unknown, enBase?: unknown) {
  // Merge order: English base (common+extras) → locale common → locale extras.
  // Ensures keys that exist only in en/extras are never missing in other locales.
  const merged = deepMerge(deepMerge(enBase ?? common, common), extras);
  return merged;
}

const enTranslation = buildTranslation(enCommon, enExtras);

export const resources = {
  en: { translation: enTranslation },
  fr: { translation: buildTranslation(frCommon, frExtras, enTranslation) },
  es: { translation: buildTranslation(esCommon, esExtras, enTranslation) },
  ar: { translation: buildTranslation(arCommon, arExtras, enTranslation) },
  zh: { translation: buildTranslation(zhCommon, zhExtras, enTranslation) },
  ff: { translation: buildTranslation(ffCommon, ffExtras, enTranslation) },
} as const;

export type SupportedLocale = keyof typeof resources;
