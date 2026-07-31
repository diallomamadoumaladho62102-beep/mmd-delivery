import type { Metadata } from "next";
import {
  cmsPageMetadata,
  renderCmsPage,
} from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("restaurants", "Restaurant partners");
}

export default async function RestaurantMarketingPage() {
  return renderCmsPage("restaurants");
}
