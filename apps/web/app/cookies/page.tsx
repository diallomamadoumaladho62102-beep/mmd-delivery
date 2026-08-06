import type { Metadata } from "next";
import { renderComingSoonPage } from "@/components/site/renderComingSoonPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cookies — MMD Delivery",
  description: "MMD Delivery cookie policy — coming soon.",
  robots: "noindex,follow",
};

export default async function Page() {
  return renderComingSoonPage(
    "Cookies",
    "Our cookie policy page is coming soon. See Privacy for current data practices, or contact support with questions.",
  );
}
