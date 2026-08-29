import type { Metadata } from "next";
import { renderInAppServicePage } from "@/components/site/renderInAppServicePage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Taxi — MMD Delivery",
  description:
    "Book MMD Taxi in the MMD Delivery app. Enter pickup and dropoff, review the official quote (subtotal, service fee, tax), then confirm before payment.",
  robots: "index,follow",
};

export default async function Page() {
  return renderInAppServicePage({
    title: "MMD Taxi",
    description:
      "Taxi booking is live in the MMD Delivery app. The customer confirms pickup, dropoff, vehicle class, and the official fare before any ride is created or paid. This website does not take taxi payments.",
    primaryHref: "/drivers",
    primaryLabel: "How driving works",
  });
}
