import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Taxi — MMD Delivery",
  description:
    "Request an MMD Taxi quote on this website. The server calculates distance, duration, and the fare before any ride is created.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    eyebrow: "Order on the web",
    title: "MMD Taxi",
    description:
      "Enter pickup and destination on this website. The server returns the fare. Card markets continue through Stripe Checkout. Guinea cash uses the existing cash path. The mobile app remains available and is not required.",
    primaryHref: "/client/taxi",
    primaryLabel: "Book a taxi on the web",
  });
}
