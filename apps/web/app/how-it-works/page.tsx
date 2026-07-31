import type { Metadata } from "next";
import { cmsPageMetadata, renderCmsPage } from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("how-it-works", "How it works");
}

export default async function Page() {
  return renderCmsPage("how-it-works");
}
