import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Food Delivery — MMD Delivery",
  description:
    "Order from approved restaurants in the MMD Delivery app. Menu, options, server quote, and checkout stay inside the official Food flow.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    title: "Food delivery",
    description:
      "Food ordering is available in the MMD Delivery app: browse an approved restaurant menu, choose options, see the official server total, then confirm before payment. Restaurant partners can also start on the Restaurants page.",
    primaryHref: "/p/restaurants",
    primaryLabel: "Restaurants",
  });
}
