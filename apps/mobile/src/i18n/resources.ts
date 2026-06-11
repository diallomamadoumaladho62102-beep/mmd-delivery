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
  const merged = deepMerge(deepMerge(enBase ?? common, common), extras);
  return merged;
}

export const resources = {
  en: { translation: buildTranslation(enCommon, enExtras) },
  fr: { translation: buildTranslation(frCommon, frExtras, enCommon) },
  es: { translation: buildTranslation(esCommon, esExtras, enCommon) },
  ar: { translation: buildTranslation(arCommon, arExtras, enCommon) },
  zh: { translation: buildTranslation(zhCommon, zhExtras, enCommon) },
  ff: { translation: buildTranslation(ffCommon, ffExtras, enCommon) },
} as const;

export type SupportedLocale = keyof typeof resources;
