import ComingSoonPage from "./ComingSoonPage";
import SiteAnalytics from "./SiteAnalytics";
import SiteShell from "./SiteShell";
import { loadSiteChrome } from "./renderCmsPage";

export async function renderComingSoonPage(title: string, description?: string) {
  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();

  return (
    <>
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <ComingSoonPage title={title} description={description} />
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
