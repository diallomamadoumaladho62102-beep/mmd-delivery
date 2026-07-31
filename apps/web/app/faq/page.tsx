import type { Metadata } from "next";
import { cmsPageMetadata, renderCmsPage } from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("faq", "FAQ");
}

export default async function Page() {
  return renderCmsPage("faq");
}
