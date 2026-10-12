import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Package Delivery — MMD Delivery",
  description:
    "Request a package delivery on this website. Pickup, destination, and parcel details are priced by the server when the request is confirmed.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    eyebrow: "Order on the web",
    title: "Package delivery",
    description:
      "Sign in and enter pickup, destination, and parcel details. The server sets the fare when the request is created. The mobile app is optional.",
    primaryHref: "/orders/create",
    primaryLabel: "Send a package on the web",
  });
}
