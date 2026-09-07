"use client";

import { useCallback } from "react";
import { useWebI18n } from "@/components/WebI18nProvider";
import { adminT } from "@/i18n/adminUiI18n";

/** Admin page-body translator bound to the shared web locale cookie. */
export function useAdminT() {
  const { locale, dir } = useWebI18n();
  const t = useCallback((english: string) => adminT(english, locale), [locale]);
  return { t, locale, dir, isRtl: dir === "rtl" };
}
