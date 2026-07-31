import type { Metadata } from "next";
import {
  cmsPageMetadata,
  renderCmsPage,
} from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("business", "Business");
}

export default async function BusinessMarketingPage() {
  return renderCmsPage("business");
}
