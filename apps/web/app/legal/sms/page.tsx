import type { Metadata } from "next";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import SmsProgramView from "@/components/site/SmsProgramView";
import { SMS_PROGRAM_SEO } from "@/components/site/smsProgramCopy";
import { loadSiteChrome } from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: SMS_PROGRAM_SEO.title,
    description: SMS_PROGRAM_SEO.description,
    robots: SMS_PROGRAM_SEO.robots,
    alternates: { canonical: "https://www.mmddelivery.com/legal/sms" },
  };
}

export default async function SmsProgramPage() {
  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();

  return (
    <>
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <SmsProgramView />
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
