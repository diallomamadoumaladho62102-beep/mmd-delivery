import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Food Delivery — MMD Delivery",
  description:
    "Order from restaurants on this website. Menus, quantities, delivery address, and the server total stay in the signed-in food flow.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    eyebrow: "Order on the web",
    title: "Food delivery",
    description:
      "Sign in, choose a restaurant menu, set quantities and a delivery address, then review the server total before payment. The mobile app is optional.",
    primaryHref: "/orders/new",
    primaryLabel: "Order food on the web",
  });
}
