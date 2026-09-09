"use client";

import { useRouter } from "next/navigation";
import { useWebI18n } from "@/components/WebI18nProvider";
import { useAdminT } from "@/i18n/useAdminT";
import { WEB_LOCALE_LABELS, WEB_LOCALES, type WebLocale } from "@/i18n/locales";

/** Shared locale cookie switcher for public, portal, and auth surfaces. */
export default function WebLanguageSwitcher({
  className = "",
}: {
  className?: string;
}) {
  const router = useRouter();
  const { locale } = useWebI18n();
  const { t } = useAdminT();

  function changeLocale(next: WebLocale) {
    document.cookie = `mmd_web_locale=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  return (
    <label className={`inline-flex items-center gap-2 text-xs ${className}`}>
      <span className="sr-only">{t("Language")}</span>
      <select
        value={locale}
        aria-label={t("Language")}
        onChange={(e) => changeLocale(e.target.value as WebLocale)}
        className={`rounded-lg border border-current/30 bg-transparent px-2 py-1 text-xs ${className}`}
      >
        {WEB_LOCALES.map((code) => (
          <option key={code} value={code}>
            {WEB_LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
