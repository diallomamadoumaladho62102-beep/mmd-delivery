import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules, Platform } from "react-native";
import { GLOBAL_LOCALE_KEY, LOCALE_USER_SET_KEY } from "./storage";

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

function readNativeDeviceLocale(): string | null {
  try {
    if (Platform.OS === "ios") {
      const settings = (
        NativeModules as {
          SettingsManager?: { settings?: { AppleLocale?: string; AppleLanguages?: string[] } };
        }
      ).SettingsManager?.settings;
      const locale = settings?.AppleLocale || settings?.AppleLanguages?.[0];
      if (locale) return String(locale);
    }

    if (Platform.OS === "android") {
      const locale = (
        NativeModules as { I18nManager?: { localeIdentifier?: string } }
      ).I18nManager?.localeIdentifier;
      if (locale) return String(locale);
    }
  } catch {
    // ignore
  }
  return null;
}

/** Detect device / OS locale (native + Intl fallbacks). */
export function detectDeviceLocale(): string {
  const native = readNativeDeviceLocale();
  if (native) return ensureAppLocale(native);

  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    if (intlLocale) return ensureAppLocale(intlLocale);
  } catch {
    // ignore
  }

  try {
    const nav = (globalThis as typeof globalThis & { navigator?: { language?: string } })
      .navigator;
    if (nav?.language) return ensureAppLocale(nav.language);
  } catch {
    // ignore
  }

  return "en";
}

/**
 * Priority: explicit user choice → saved global → device → English.
 */
export async function resolveStartupLocale(): Promise<string> {
  const [userSet, saved] = await Promise.all([
    AsyncStorage.getItem(LOCALE_USER_SET_KEY),
    AsyncStorage.getItem(GLOBAL_LOCALE_KEY),
  ]);

  if (userSet === "true" && saved?.trim()) {
    return ensureAppLocale(saved.trim());
  }

  if (saved?.trim()) {
    return ensureAppLocale(saved.trim());
  }

  const device = detectDeviceLocale();
  await AsyncStorage.setItem(GLOBAL_LOCALE_KEY, device);
  return device;
}

export async function markLocaleUserSelected(locale: string): Promise<void> {
  const next = ensureAppLocale(locale);
  await AsyncStorage.multiSet([
    [GLOBAL_LOCALE_KEY, next],
    [LOCALE_USER_SET_KEY, "true"],
  ]);
}
