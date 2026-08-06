import type { Metadata } from "next";
import { renderComingSoonPage } from "@/components/site/renderComingSoonPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Package Delivery — MMD Delivery",
  description: "MMD Package Delivery — coming soon.",
  robots: "noindex,follow",
};

export default async function Page() {
  return renderComingSoonPage(
    "Package Delivery",
    "A dedicated Package Delivery page is coming soon. See How it works for the current quote-to-delivery flow.",
  );
}
