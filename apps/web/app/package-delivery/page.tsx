import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Package Delivery — MMD Delivery",
  description:
    "Send a package in the MMD Delivery app. Pickup, dropoff, description, official server quote, then confirm before payment.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    title: "Package delivery",
    description:
      "Package delivery is available in the MMD Delivery app. The customer enters pickup and dropoff, describes the parcel, reviews the official server quote (subtotal, service fee, tax, total), then confirms before payment. Weight and size are not required by the current pricing engine.",
    primaryHref: "/how-it-works",
    primaryLabel: "How it works",
  });
}
