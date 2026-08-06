import type { Metadata } from "next";
import { renderComingSoonPage } from "@/components/site/renderComingSoonPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — MMD Delivery",
  description: "MMD Delivery pricing — coming soon.",
  robots: "noindex,follow",
};

export default async function Page() {
  return renderComingSoonPage(
    "Pricing",
    "Transparent pricing details are coming soon. Contact us for business or partner quotes in the meantime.",
  );
}
