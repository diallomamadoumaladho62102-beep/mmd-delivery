import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Services — MMD Delivery",
  description:
    "MMD Delivery services in the app: taxi, food delivery, package delivery, marketplace browse, and restaurant or driver work.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    title: "Services",
    description:
      "The MMD Delivery app currently supports taxi rides, food delivery from approved restaurants, package delivery, marketplace browsing, and partner work for drivers and restaurants. Marketplace live checkout stays off until payout certification is complete. Pricing is always shown in-app before you pay.",
    primaryHref: "/how-it-works",
    primaryLabel: "How it works",
  });
}
