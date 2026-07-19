"use client";

import PartnerSubscriptionsPortal from "@/components/subscriptions/PartnerSubscriptionsPortal";

export default function SellerSubscriptionsPage() {
  return (
    <PartnerSubscriptionsPortal
      partnerLabel="Vendeur"
      summaryPath="/api/seller/subscriptions/summary"
      actionsPath="/api/seller/subscriptions/actions"
      backHref="/seller"
    />
  );
}
