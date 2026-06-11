"use client";

import Link from "next/link";
import { useWebI18n } from "@/components/WebI18nProvider";

const FEATURE_KEYS = [
  { icon: "📍", title: "public.feature.tracking", desc: "public.feature.trackingDesc" },
  { icon: "🔒", title: "public.feature.payments", desc: "public.feature.paymentsDesc" },
  { icon: "💰", title: "public.feature.driver", desc: "public.feature.driverDesc" },
  { icon: "🏪", title: "public.feature.restaurant", desc: "public.feature.restaurantDesc" },
] as const;

export default function PublicHomeContent() {
  const { t } = useWebI18n();

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 24,
          marginBottom: 42,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <img
            src="/brand/mmd-logo.png"
            alt="MMD Delivery"
            style={{
              width: 86,
              height: 86,
              borderRadius: 24,
              objectFit: "cover",
            }}
          />
          <div>
            <div style={{ fontSize: 28, fontWeight: 800 }}>{t("app.title")}</div>
            <div style={{ opacity: 0.75, marginTop: 4 }}>{t("public.subhero")}</div>
          </div>
        </div>
        <nav style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <Link href="/client">{t("nav.client")}</Link>
          <Link href="/restaurants">{t("nav.restaurants")}</Link>
          <Link href="/login">{t("nav.login")}</Link>
          <Link href="/signup">{t("nav.signup")}</Link>
        </nav>
      </div>

      <h1 style={{ fontSize: 48, fontWeight: 900, maxWidth: 720, lineHeight: 1.1 }}>
        {t("public.hero")}
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 18,
          marginTop: 48,
        }}
      >
        {FEATURE_KEYS.map((feature) => (
          <div
            key={feature.title}
            style={{
              padding: 20,
              borderRadius: 18,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ fontSize: 28 }}>{feature.icon}</div>
            <div style={{ fontWeight: 800, marginTop: 10 }}>{t(feature.title)}</div>
            <div style={{ opacity: 0.75, marginTop: 6, lineHeight: 1.5 }}>
              {t(feature.desc)}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
