import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Sora } from "next/font/google";
import "./globals.css";
import { normalizeWebLocale, webDir, webT } from "../src/i18n/locales";
import { WebI18nProvider } from "../src/components/WebI18nProvider";
import WebVitalsReporter from "../src/components/WebVitalsReporter";
import { CANONICAL_SITE_ORIGIN } from "../src/lib/productionSite";

const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sora",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = normalizeWebLocale(cookieStore.get("mmd_web_locale")?.value);
  return {
    metadataBase: new URL(CANONICAL_SITE_ORIGIN),
    title: webT("app.title", locale),
    description: webT("app.description", locale),
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = normalizeWebLocale(
    cookieStore.get("mmd_web_locale")?.value ??
      headerStore.get("accept-language")?.split(",")[0]
  );

  return (
    <html lang={locale} dir={webDir(locale)} className={sora.variable}>
      <body className="bg-gray-50 min-h-screen">
        <WebI18nProvider locale={locale}>
          <WebVitalsReporter />
          {children}
        </WebI18nProvider>
      </body>
    </html>
  );
}
