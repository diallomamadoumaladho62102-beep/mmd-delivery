// apps/mobile/src/i18n/resources.ts
// ✅ i18n resources viennent des JSON (1 source de vérité)
// ✅ On garde seulement les 6 langues autorisées : en, fr, es, ar, zh, ff

import en from "./locales/en/common.json";
import fr from "./locales/fr/common.json";
import es from "./locales/es/common.json";
import ar from "./locales/ar/common.json";
import zh from "./locales/zh/common.json";
import ff from "./locales/ff/common.json";

// ✅ Deep merge simple (EN -> override by target language)
function isObject(v: any) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base: any, override: any): any {
  if (!isObject(base)) return override ?? base;
  const out: any = { ...base };
  if (!isObject(override)) return out;

  for (const k of Object.keys(override)) {
    const bv = out[k];
    const ov = override[k];
    if (isObject(bv) && isObject(ov)) out[k] = deepMerge(bv, ov);
    else out[k] = ov;
  }
  return out;
}

// ✅ Type i18next resources (namespace = translation)
// - en: source de vérité complète
// - fr/es/ar/zh/ff: héritent de EN pour les clés manquantes
export const resources = {
  en: { translation: en },
  fr: { translation: deepMerge(en, fr) },
  es: { translation: deepMerge(en, es) },
  ar: { translation: deepMerge(en, ar) },
  zh: { translation: deepMerge(en, zh) },
  ff: { translation: deepMerge(en, ff) },
} as const;

export type SupportedLocale = keyof typeof resources;
