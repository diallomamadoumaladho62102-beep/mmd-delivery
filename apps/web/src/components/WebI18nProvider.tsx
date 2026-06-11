"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  normalizeWebLocale,
  webDir,
  webT,
  type WebLocale,
} from "@/i18n/locales";

type WebI18nContextValue = {
  locale: WebLocale;
  dir: "ltr" | "rtl";
  t: (key: string) => string;
};

const WebI18nContext = createContext<WebI18nContextValue>({
  locale: "en",
  dir: "ltr",
  t: (key) => key,
});

export function WebI18nProvider({
  locale: rawLocale,
  children,
}: {
  locale: string;
  children: ReactNode;
}) {
  const value = useMemo(() => {
    const locale = normalizeWebLocale(rawLocale);
    return {
      locale,
      dir: webDir(locale),
      t: (key: string) => webT(key, locale),
    };
  }, [rawLocale]);

  return (
    <WebI18nContext.Provider value={value}>{children}</WebI18nContext.Provider>
  );
}

export function useWebI18n() {
  return useContext(WebI18nContext);
}
