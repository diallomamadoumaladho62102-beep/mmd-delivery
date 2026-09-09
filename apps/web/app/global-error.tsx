"use client";

import { useEffect, useMemo } from "react";
import { captureProductionException } from "@/lib/sentryCapture";
import { adminT } from "@/i18n/adminUiI18n";
import { normalizeWebLocale } from "@/i18n/locales";

function localeFromCookie() {
  if (typeof document === "undefined") return normalizeWebLocale("en");
  const match = document.cookie.match(/(?:^|; )mmd_web_locale=([^;]+)/);
  return normalizeWebLocale(match?.[1] ? decodeURIComponent(match[1]) : "en");
}

/**
 * Root global error boundary (replaces the whole document on a fatal render
 * error). Reports to Sentry and shows a minimal, self-contained fallback so
 * the user is never left on a blank white screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = useMemo(() => localeFromCookie(), []);
  const t = (source: string) => adminT(source, locale);

  useEffect(() => {
    captureProductionException("web.global_error_boundary", error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang={locale === "ar" ? "ar" : locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "#0f172a", fontSize: 20, fontWeight: 600 }}>
            {t("Une erreur inattendue est survenue")}
          </h2>
          <p style={{ color: "#475569", fontSize: 14, maxWidth: 420 }}>
            {t("L’application a rencontré un problème. Vous pouvez recharger la page.")}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            {t("Recharger")}
          </button>
        </div>
      </body>
    </html>
  );
}
