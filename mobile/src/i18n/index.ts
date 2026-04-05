// apps/mobile/src/i18n/index.ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager } from "react-native";
import { resources as rawResources } from "./resources";
import {
  getRoleLocale,
  setRoleLocale,
  getGlobalLocale,
  setGlobalLocale,
  isRtlLocale,
  Role,
} from "./storage";

let booted = false;

/**
 * ✅ Langues autorisées (6 فقط)
 * - en: English (DEFAULT)
 * - fr: Français
 * - es: Español
 * - ar: العربية (RTL)
 * - zh: 中文
 * - ff: Pulaar / Fulfulde
 */
const ALLOWED_LOCALES = new Set(["en", "fr", "es", "ar", "zh", "ff"]);
const DEFAULT_LOCALE = "en"; // ✅ ENGLISH AS DEFAULT

function normalizeLocale(locale: string) {
  const x = String(locale || "").trim().toLowerCase();

  // accepter variantes courantes
  if (x.startsWith("zh")) return "zh";
  if (x.startsWith("ar")) return "ar";
  if (x.startsWith("es")) return "es";
  if (x.startsWith("en")) return "en";
  if (x.startsWith("fr")) return "fr";
  if (x.startsWith("ff")) return "ff";

  return x;
}

function ensureAllowedLocale(locale: string) {
  const n = normalizeLocale(locale);
  return ALLOWED_LOCALES.has(n) ? n : DEFAULT_LOCALE;
}

/**
 * Helpers: get/set deep path safely
 */
function getDeep(obj: any, path: string) {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function setDeepIfMissing(obj: any, path: string, value: any) {
  if (value == null) return;
  const parts = path.split(".");
  let cur = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }

  const last = parts[parts.length - 1];
  if (cur[last] == null) cur[last] = value;
}

/**
 * ✅ Ensure string keys exist even if a parent key is an object.
 * Example: if "common.payment" is an object, we still ensure
 * "common.payment.title" exists and is a string.
 */
function ensureStringFallback(t: any, path: string, fallback: string) {
  // If the exact key exists and is already a string, do nothing.
  const existing = getDeep(t, path);
  if (typeof existing === "string" && existing.trim().length > 0) return;

  // Otherwise set it if missing / null / not string
  setDeepIfMissing(t, path, fallback);

  // If it existed but was not a string (ex: object), we overwrite it safely at leaf.
  // setDeepIfMissing won't overwrite, so we force set only when needed:
  const after = getDeep(t, path);
  if (typeof after !== "string") {
    // force set leaf
    const parts = path.split(".");
    let cur = t;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = fallback;
  }
}

/**
 * ✅ Compat layer: alias anciennes clés → nouvelles
 */
function applyCompatAliases(resources: any) {
  for (const lng of Object.keys(resources || {})) {
    const t = resources?.[lng]?.translation;
    if (!t || typeof t !== "object") continue;

    // common.*
    setDeepIfMissing(t, "common.edit", getDeep(t, "shared.common.edit"));
    setDeepIfMissing(t, "common.save", getDeep(t, "shared.common.save"));
    setDeepIfMissing(t, "common.cancel", getDeep(t, "shared.common.cancel"));
    setDeepIfMissing(t, "common.loading", getDeep(t, "shared.common.loading"));

    // transport
    setDeepIfMissing(
      t,
      "common.transport.bike",
      getDeep(t, "driver.auth.transport.bike")
    );
    setDeepIfMissing(
      t,
      "common.transport.car",
      getDeep(t, "driver.auth.transport.car")
    );
    setDeepIfMissing(
      t,
      "common.transport.moto",
      getDeep(t, "driver.auth.transport.moto")
    );

    // payment (compat status keys)
    setDeepIfMissing(t, "common.payment.notConfigured", getDeep(t, "common.notConfigured"));
    setDeepIfMissing(t, "common.payment.configured", getDeep(t, "common.ready"));

    // ✅ NEW: make sure payment label/title are ALWAYS strings (fixes "returned an object")
    // We prefer:
    // - common.payment.title (new)
    // - common.payment.label (new alias)
    // These do not break if common.payment is an object.
    ensureStringFallback(t, "common.payment.title", lng === "fr" ? "Paiement" : "Payment");
    ensureStringFallback(t, "common.payment.label", lng === "fr" ? "Paiement" : "Payment");

    // verified
    setDeepIfMissing(t, "common.verified.notVerified", getDeep(t, "common.notConfigured"));
    setDeepIfMissing(t, "common.verified.bike", getDeep(t, "common.driverTier.confirmed"));

    // status
    setDeepIfMissing(t, "common.status.missing", getDeep(t, "common.toAdd"));

    // driver
    setDeepIfMissing(
      t,
      "common.driver.defaultName",
      getDeep(t, "common.profile.placeholderName")
    );
  }

  return resources;
}

export async function initI18n(defaultLocale = DEFAULT_LOCALE) {
  if (booted && i18n.isInitialized) return i18n;

  const wanted = ensureAllowedLocale(defaultLocale);

  const resourcesAll = applyCompatAliases({ ...rawResources });

  // ✅ garder seulement les 6 langues
  const resources: any = {};
  for (const lng of ALLOWED_LOCALES) {
    if (resourcesAll?.[lng]) resources[lng] = resourcesAll[lng];
  }

  await i18n.use(initReactI18next).init({
    resources,
    lng: wanted,
    fallbackLng: DEFAULT_LOCALE, // ✅ fallback = EN
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    keySeparator: ".",
    nsSeparator: ":",
    defaultNS: "translation",
  });

  booted = true;

  console.log("✅ i18n READY", {
    lang: i18n.language,
    allowed: Array.from(ALLOWED_LOCALES),
  });

  return i18n;
}

export function setAppLocale(locale: string) {
  const next = ensureAllowedLocale(locale);
  return i18n.changeLanguage(next);
}

/**
 * ✅ RTL support (ar)
 */
async function applyRTLIfNeeded(locale: string) {
  const next = ensureAllowedLocale(locale);
  const wantRTL = isRtlLocale(next);
  const rtlChanged = I18nManager.isRTL !== wantRTL;
  if (!rtlChanged) return;

  try {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(wantRTL);
  } catch {}

  // reload app only if RTL flips
  try {
    const Updates = await import("expo-updates");
    if (Updates?.reloadAsync) await Updates.reloadAsync();
  } catch {}
}

/**
 * ✅ Change locale: update GLOBAL (source of truth) + role (compat)
 */
export async function setLocaleForRoleAndApply(role: Role, locale: string) {
  const next = ensureAllowedLocale(locale);

  // ✅ global is the source of truth
  await setGlobalLocale(next);

  // ✅ keep role value too (compat / future)
  await setRoleLocale(role, next);

  if (!i18n.isInitialized) await initI18n(next);

  await setAppLocale(next);
  await applyRTLIfNeeded(next);
}

/**
 * ✅ Sync locale: read GLOBAL first, then role as fallback
 */
export async function syncLocaleForRole(role: Role) {
  const global = await getGlobalLocale();
  const locale = global || (await getRoleLocale(role)) || DEFAULT_LOCALE;
  const next = ensureAllowedLocale(locale);

  if (!i18n.isInitialized) {
    await initI18n(next);
  } else if (i18n.language !== next) {
    await setAppLocale(next);
  }

  await applyRTLIfNeeded(next);
  return next;
}

export default i18n;
