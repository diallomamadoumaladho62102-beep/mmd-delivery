import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { normalizeWebLocale, webDir, webT } from "../src/i18n/locales";
import { WebI18nProvider } from "../src/components/WebI18nProvider";

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  const locale = normalizeWebLocale(cookieStore.get("mmd_web_locale")?.value);
  return {
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
    <html lang={locale} dir={webDir(locale)}>
      <body className="bg-gray-50 min-h-screen">
        <WebI18nProvider locale={locale}>{children}</WebI18nProvider>
      </body>
    </html>
  );
}