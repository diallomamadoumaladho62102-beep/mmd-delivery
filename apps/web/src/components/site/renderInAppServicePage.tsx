import Link from "next/link";
import SiteAnalytics from "./SiteAnalytics";
import SiteShell from "./SiteShell";
import { loadSiteChrome } from "./renderCmsPage";
import {
  siteContainerClass,
  siteHeadingClass,
  sitePrimaryBtnClass,
  siteSecondaryBtnClass,
  siteSubheadingClass,
} from "./siteTheme";

export async function renderInAppServicePage(input: {
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
}) {
  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();

  return (
    <>
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <section className="border-b border-white/5">
          <div className={`${siteContainerClass} py-16 sm:py-24`}>
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.16em] text-orange-300">
              Available in the MMD Delivery app
            </p>
            <h1 className={siteHeadingClass}>{input.title}</h1>
            <p className={siteSubheadingClass}>{input.description}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href={input.primaryHref ?? "/download"} className={sitePrimaryBtnClass}>
                {input.primaryLabel ?? "Download"}
              </Link>
              <Link href="/contact" className={siteSecondaryBtnClass}>
                Contact us
              </Link>
            </div>
          </div>
        </section>
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
