// apps/mobile/src/i18n/storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Role = "driver" | "client" | "restaurant";
export type Locale = string;

/**
 * 🔤 Langue globale (UNE SEULE pour toute l’app)
 */
const GLOBAL_LOCALE_KEY = "mmd_locale_global";

/**
 * 🔤 Langue par rôle (gardé pour compatibilité / ancien code)
 */
const KEY_BY_ROLE: Record<Role, string> = {
  driver: "mmd_locale_driver",
  client: "mmd_locale_client",
  restaurant: "mmd_locale_restaurant",
};

/**
 * ✅ RTL detection
 */
export function isRtlLocale(locale: string) {
  const x = String(locale || "").trim().toLowerCase();
  return x === "ar"; // فقط العربية
}

/* =====================================================
   🌍 GLOBAL LOCALE (SOURCE DE VÉRITÉ)
   ===================================================== */

/**
 * Lire la langue globale
 * 👉 Anglais par défaut
 */
export async function getGlobalLocale(): Promise<Locale> {
  const v = await AsyncStorage.getItem(GLOBAL_LOCALE_KEY);
  return v && v.trim() ? v.trim() : "en";
}

/**
 * Sauvegarder la langue globale
 */
export async function setGlobalLocale(locale: Locale) {
  const next = String(locale || "en").trim() || "en";
  await AsyncStorage.setItem(GLOBAL_LOCALE_KEY, next);
}

/* =====================================================
   🧑‍💼 LOCALE PAR RÔLE (OPTIONNEL / COMPAT)
   ===================================================== */

/**
 * Lire la langue d’un rôle
 * ⚠️ fallback = langue globale → sinon anglais
 */
export async function getRoleLocale(role: Role): Promise<Locale> {
  const key = KEY_BY_ROLE[role];
  const v = await AsyncStorage.getItem(key);
  if (v && v.trim()) return v.trim();

  // fallback global
  return getGlobalLocale();
}

/**
 * Stockage uniquement (pas de i18n/changeLanguage ici)
 */
export async function setRoleLocale(role: Role, locale: Locale) {
  const next = String(locale || "en").trim() || "en";
  const key = KEY_BY_ROLE[role];
  await AsyncStorage.setItem(key, next);
}

/**
 * Compat ancien nom
 */
export async function setLocaleForRole(role: Role, locale: Locale) {
  await setRoleLocale(role, locale);
}
