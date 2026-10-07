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

import enCancellation from "./locales/en/cancellation.json";
import frCancellation from "./locales/fr/cancellation.json";
import esCancellation from "./locales/es/cancellation.json";
import arCancellation from "./locales/ar/cancellation.json";
import zhCancellation from "./locales/zh/cancellation.json";
import ffCancellation from "./locales/ff/cancellation.json";

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

function buildTranslation(
  common: unknown,
  extras: unknown,
  enBase?: unknown,
  localePack?: unknown,
) {
  // Merge order: English base (common+extras) → locale common → locale extras → locale pack.
  // Ensures keys that exist only in en/extras are never missing in other locales.
  const merged = deepMerge(deepMerge(enBase ?? common, common), extras);
  return localePack ? deepMerge(merged, localePack) : merged;
}

const enTranslation = buildTranslation(enCommon, enExtras, undefined, enCancellation);

export const resources = {
  en: { translation: enTranslation },
  fr: { translation: buildTranslation(frCommon, frExtras, enTranslation, frCancellation) },
  es: { translation: buildTranslation(esCommon, esExtras, enTranslation, esCancellation) },
  ar: { translation: buildTranslation(arCommon, arExtras, enTranslation, arCancellation) },
  zh: { translation: buildTranslation(zhCommon, zhExtras, enTranslation, zhCancellation) },
  ff: { translation: buildTranslation(ffCommon, ffExtras, enTranslation, ffCancellation) },
} as const;

export type SupportedLocale = keyof typeof resources;
