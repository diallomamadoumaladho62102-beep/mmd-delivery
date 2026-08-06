import type { Metadata } from "next";
import { renderComingSoonPage } from "@/components/site/renderComingSoonPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Food Delivery — MMD Delivery",
  description: "MMD Food Delivery — coming soon.",
  robots: "noindex,follow",
};

export default async function Page() {
  return renderComingSoonPage(
    "Food Delivery",
    "A dedicated Food Delivery page is coming soon. Restaurant partners are already covered on the Restaurants page.",
  );
}
