"use client";

import PartnerSubscriptionsPortal from "@/components/subscriptions/PartnerSubscriptionsPortal";

export default function RestaurantSubscriptionsPage() {
  return (
    <PartnerSubscriptionsPortal
      partnerLabel="Restaurant"
      summaryPath="/api/restaurant/subscriptions/summary"
      actionsPath="/api/restaurant/subscriptions/actions"
      backHref="/orders/restaurant"
    />
  );
}
