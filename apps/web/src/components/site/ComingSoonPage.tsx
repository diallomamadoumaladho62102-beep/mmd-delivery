"use client";


import { useAdminT } from "@/i18n/useAdminT";
import Link from "next/link";
import {
  siteContainerClass,
  siteHeadingClass,
  sitePrimaryBtnClass,
  siteSecondaryBtnClass,
  siteSubheadingClass,
} from "./siteTheme";

export type ComingSoonPageProps = {
  title: string;
  description?: string;
};

/**
 * Temporary public placeholder for routes that are part of the site IA
 * but not yet fully implemented as marketing content.
 */
export default function ComingSoonPage({
  title,
  description = "This page is coming soon. In the meantime, explore the rest of MMD Delivery.",
}: ComingSoonPageProps) {
  const { t } = useAdminT();

  return (
    <section className="border-b border-white/5">
      <div className={`${siteContainerClass} py-16 sm:py-24`}>
        <p className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-orange-300">
          {t("Coming soon")}
        </p>
        <h1 className={siteHeadingClass}>{title}</h1>
        <p className={siteSubheadingClass}>{description}</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/" className={sitePrimaryBtnClass}>
            {t("Back to Home")}
          </Link>
          <Link href="/contact" className={siteSecondaryBtnClass}>
            {t("Contact us")}
          </Link>
        </div>
      </div>
    </section>
  );
}
