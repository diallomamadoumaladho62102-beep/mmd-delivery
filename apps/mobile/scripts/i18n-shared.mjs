/**
 * Shared helpers for the locale JSON tooling (audit / dump / translate).
 *
 * Everything reads the locale files with the SAME merge order as src/i18n/resources.ts
 * (english base -> locale common.json -> locale extras.json), so what the tools measure is
 * what the app actually renders.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

export const HERE = path.dirname(url.fileURLToPath(import.meta.url));
export const LOCALES_DIR = path.join(HERE, '..', 'src', 'i18n', 'locales');
/** Translation arrays in the tooling follow this order. */
export const LOCALES = ['fr', 'es', 'ar', 'zh', 'ff'];

export const PRIORITY_PREFIXES = [
  'driver.',
  'payment.',
  'client.auth.',
  'locationPicker.',
  'maskedCall.',
  'promotions.',
  'mmdPlus.',
  'restaurant.automation.',
  'restaurant.autoPrint.',
  'restaurant.orderPrint.',
  'taxi.',
];

/** Values that stay identical to English on purpose: brands, acronyms, units, symbols. */
export const INTENTIONAL = JSON.parse(
  fs.readFileSync(path.join(HERE, 'i18n-intentional-identical.json'), 'utf8'),
);
/** Values whose translation may legitimately match the French one (Fulfulde loanwords). */
const INTENTIONAL_FRENCH = JSON.parse(
  fs.readFileSync(path.join(HERE, 'i18n-intentional-french.json'), 'utf8'),
);

/** Latin tokens allowed inside an Arabic or Chinese value (brands, codes, samples). */
const LATIN_ALLOWED =
  /MMD Delivery|MMD Driver|MMD Taxi|MMD|Stripe|Identity|Connect|Dashboard|Accounts|Overview|Express|GPS|PDF|TIN|ID|OK|Marketplace|Expo|Go|iOS|iPhone|Android|Apple|Google|Bluetooth|WhatsApp|Wi-Fi|SMS|AI|VIP|JFK|LGA|EWR|NYC|US|W-9|ZIP|Beta|Uber|HEIC|JPG|Base64|ArrayBuffer|READY|AppNavigator|DriverChat|OrderChat|orderId|requestId|uri|avatars|driver-docs|driver_documents|driver_profiles|profiles|EXPO_PUBLIC_[A-Z_]+|English|Fran|ais|Espa|ol|Pulaar|Fulfulde|Honda|Toyota|Accord|Corolla|Black|ABC|Mamadou|Pizzas|Brooklyn|Queens|Manhattan|Bronx|Standard|Elite|Plus|Premium|Boost|DB|Debug|ISO|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|shadow|Shadow|Storage|URL|FAQ|mi|km|min|max|pts|e\.g|p\. ej/g;

/**
 * English words that never belong in a French or Spanish UI string. The earlier automated pass
 * substituted words one by one, leaving hybrids such as "Taxesi history" or "Supprimer failed".
 */
const ENGLISH_MARKERS =
  /\b(failed|history|loyalty|pinned|available|unavailable|address|addresses|checkout|settings|unknown|empty|loading|saving|request|please|your|you|the|and|with|from|this|that|cannot|enter|choose|select|remove|update|retry|ride|rides|trip|trips|driver|drivers|order|orders|payment|delivery|pickup|dropoff|shop|seller|sellers|product|products|review|reviews|upload|download|sent|missing|required|invalid|once|day|read|full|balance|optional|files|weekly|tip|tips)\b/i;
/** Same idea for Fulfulde, restricted to words a Fulfulde string would never borrow. */
const ENGLISH_MARKERS_FF =
  /\b(failed|history|loyalty|pinned|available|unavailable|address|checkout|unknown|empty|loading|saving|please|your|you|the|cannot|choose|select|remove|update|retry|once|read|optional|files|weekly|tip|tips|delivery|camera|wallet|online|offline|password|passwords|characters|login)\b/i;

export const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};

export const readJson = (locale, file) => {
  const p = path.join(LOCALES_DIR, locale, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};

export const readFlat = (locale, file) => flatten(readJson(locale, file));

/** Effective (merged) map for a locale: common then extras. */
export const merged = (locale) => ({
  ...readFlat(locale, 'common.json'),
  ...readFlat(locale, 'extras.json'),
});

export const hasLetters = (s) => typeof s === 'string' && /[a-zA-Z]/.test(s);
export const isPriority = (key) => PRIORITY_PREFIXES.some((p) => key.startsWith(p));
export const isIntentional = (value, locale) => {
  const locales = INTENTIONAL[value];
  return Array.isArray(locales) && (locales.includes('*') || locales.includes(locale));
};
export const placeholders = (s) => (String(s).match(/\{\{[^}]+\}\}/g) ?? []).sort().join('|');

/**
 * Latin words left inside an Arabic or Chinese value. Those come from an earlier automated pass
 * that copied French and substituted words, producing hybrids like "الاستلام address".
 */
export const hasStrayLatin = (value, locale) => {
  if ((locale !== 'ar' && locale !== 'zh') || typeof value !== 'string') return false;
  const bare = value.replace(/\{\{[^}]*\}\}/g, '').replace(LATIN_ALLOWED, '');
  return bare.replace(/[^A-Za-z]/g, '').length >= 3;
};

/**
 * Words the substitution pass corrupted by replacing a fragment inside a longer word
 * ("Tax" -> "Taxes" turned "Taxi" into "Taxesi", "Active" -> "Actif" gave "Actifr").
 */
const MANGLED = /Taxesi|Actifr|Livraisonsi|Entregai/;

/** English words left inside a Latin-script locale value (fr, es, ff). */
export const hasStrayEnglish = (value, enValue, locale) => {
  if (typeof value !== 'string' || value === enValue) return false;
  const bare = value.replace(/\{\{[^}]*\}\}/g, '').replace(LATIN_ALLOWED, '');
  if (MANGLED.test(bare)) return true;
  if (locale === 'fr' || locale === 'es') return ENGLISH_MARKERS.test(bare);
  return locale === 'ff' && ENGLISH_MARKERS_FF.test(bare);
};

/** French text sitting in a non-French locale (same earlier pass copied fr into es/ar/zh/ff). */
export const isFrenchLeak = (value, enValue, frValue, locale) => {
  if (locale === 'fr' || !hasLetters(value) || value !== frValue || value === enValue) return false;
  const allowed = INTENTIONAL_FRENCH[enValue];
  return !(Array.isArray(allowed) && (allowed.includes('*') || allowed.includes(locale)));
};

/**
 * A key needs work when the locale shows English, French, or a mixed-script hybrid instead of
 * its own language. `undefined` means the key is absent and falls back to English at runtime.
 */
export const needsTranslation = ({ value, enValue, frValue, locale }) =>
  value === undefined ||
  value === enValue ||
  isFrenchLeak(value, enValue, frValue, locale) ||
  hasStrayLatin(value, locale) ||
  hasStrayEnglish(value, enValue, locale);
