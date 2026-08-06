import type { Metadata } from "next";
import { renderComingSoonPage } from "@/components/site/renderComingSoonPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Services — MMD Delivery",
  description: "MMD Delivery services overview — coming soon.",
  robots: "noindex,follow",
};

export default async function Page() {
  return renderComingSoonPage(
    "Services",
    "A dedicated Services page is coming soon. You can already explore taxi, food, packages, marketplace, and business from the home page.",
  );
}
