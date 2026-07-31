import type { Metadata } from "next";
import { cmsPageMetadata, renderCmsPage } from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return cmsPageMetadata("drivers", "Drive with MMD");
}

export default async function Page() {
  return renderCmsPage("drivers");
}
