import type { SupabaseClient } from "@supabase/supabase-js";

export const APP_LOCALES = ["en", "fr", "es", "ar", "zh", "ff"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export function normalizeAppLocale(raw: unknown): AppLocale {
  const v = String(raw ?? "en")
    .trim()
    .toLowerCase();
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("es")) return "es";
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("zh")) return "zh";
  if (v.startsWith("ff") || v.startsWith("fuc") || v.startsWith("fuf") || v.startsWith("pul")) {
    return "ff";
  }
  return "en";
}

export function isRtlAppLocale(locale: AppLocale): boolean {
  return locale === "ar";
}

export function htmlLangForLocale(locale: AppLocale): string {
  if (locale === "zh") return "zh-CN";
  if (locale === "ff") return "ff";
  return locale;
}

export async function loadPreferredLocale(
  supabaseAdmin: SupabaseClient,
  userId: string | null | undefined,
): Promise<AppLocale> {
  const id = String(userId ?? "").trim();
  if (!id) return "en";
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("preferred_locale")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.log("[userLocale] preferred_locale lookup failed:", error.message);
    return "en";
  }
  return normalizeAppLocale(
    (data as { preferred_locale?: string | null } | null)?.preferred_locale,
  );
}

export type DriverPushTokenRow = {
  user_id: string;
  expo_push_token?: string | null;
  platform?: string | null;
  locale?: string | null;
};

/**
 * Load driver Expo tokens with locale when the column exists.
 * Falls back without `locale` so dispatch still works before the migration is applied.
 */
export async function loadDriverPushTokenRows(
  supabase: SupabaseClient,
  driverIds: string[],
): Promise<{ data: DriverPushTokenRow[]; error: { message: string } | null }> {
  const ids = Array.from(new Set(driverIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return { data: [], error: null };

  const primary = await supabase
    .from("user_push_tokens")
    .select("user_id,expo_push_token,role,platform,locale")
    .in("user_id", ids)
    .eq("role", "driver");

  if (!primary.error) {
    return { data: (primary.data ?? []) as DriverPushTokenRow[], error: null };
  }

  const fallback = await supabase
    .from("user_push_tokens")
    .select("user_id,expo_push_token,role,platform")
    .in("user_id", ids)
    .eq("role", "driver");

  if (!fallback.error) {
    console.log(
      "[userLocale] user_push_tokens.locale unavailable; dispatch copy falls back to en:",
      primary.error.message,
    );
    return { data: (fallback.data ?? []) as DriverPushTokenRow[], error: null };
  }

  return { data: [], error: { message: fallback.error.message } };
}
