import { cookies } from "next/headers";
import { normalizeWebLocale, type WebLocale } from "@/i18n/locales";

/** Resolve Admin locale from the shared `mmd_web_locale` cookie (server components). */
export async function getAdminWebLocale(): Promise<WebLocale> {
  const jar = await cookies();
  return normalizeWebLocale(jar.get("mmd_web_locale")?.value);
}
