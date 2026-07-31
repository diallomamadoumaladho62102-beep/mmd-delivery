import type { Metadata } from "next";
import { cmsPageMetadata, renderCmsPage } from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("press", "Press");
}

export default async function Page() {
  return renderCmsPage("press");
}
