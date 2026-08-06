import type { Metadata } from "next";
import { renderComingSoonPage } from "@/components/site/renderComingSoonPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Taxi — MMD Delivery",
  description: "MMD Taxi — coming soon.",
  robots: "noindex,follow",
};

export default async function Page() {
  return renderComingSoonPage(
    "Taxi",
    "A dedicated Taxi marketing page is coming soon. Drivers and ride information are available on the Drivers page.",
  );
}
