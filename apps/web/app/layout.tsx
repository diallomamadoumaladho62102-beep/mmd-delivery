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
    icons: {
      icon: [
        { url: "/icon.png", type: "image/png", sizes: "128x128" },
        { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
        { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
        { url: "/favicon-48x48.png", type: "image/png", sizes: "48x48" },
      ],
      apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
    },
    manifest: "/manifest.webmanifest",
    openGraph: {
      title: webT("app.title", locale),
      description: webT("app.description", locale),
      images: [
        {
          url: "/brand/og-default.png",
          width: 1200,
          height: 630,
          alt: "MMD Delivery — We Deliver With Heart",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: webT("app.title", locale),
      description: webT("app.description", locale),
      images: ["/brand/twitter-card.png"],
    },
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
