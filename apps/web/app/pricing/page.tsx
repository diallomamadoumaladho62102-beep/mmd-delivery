import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pricing — MMD Delivery",
  description:
    "MMD Delivery does not publish a public price list. Taxi, food, and package totals are calculated in the app from the official server quote before you confirm.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    title: "Pricing",
    description:
      "We do not publish a fixed public price list. Taxi, food, and package prices depend on distance, market, taxes, and service fees. The customer always sees Subtotal + Service Fee + Tax = Total in the app, then confirms before payment. Internal platform fees stay internal. Contact us for business or partner questions.",
    primaryHref: "/contact",
    primaryLabel: "Contact",
  });
}
