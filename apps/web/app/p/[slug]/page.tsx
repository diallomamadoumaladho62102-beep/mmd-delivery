import type { Metadata } from "next";
import { cmsPageMetadata, renderCmsPage } from "@/components/site/renderCmsPage";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return cmsPageMetadata(slug);
}

export default async function CmsSlugPage({ params }: Props) {
  const { slug } = await params;
  return renderCmsPage(slug);
}
