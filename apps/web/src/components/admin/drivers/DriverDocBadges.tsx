"use client";

import {
  aggregateDocGroupBadge,
  stripeIdentityBadge,
  type AdminDriverListItem,
} from "@/lib/adminDriverDisplay";
import DriverBadge from "./DriverBadge";

export default function DriverDocBadges({ driver }: { driver: AdminDriverListItem }) {
  const license = aggregateDocGroupBadge(
    driver.documents,
    ["license_front", "license_back", "driver_license"],
    { licenseExpiry: driver.license_expiry }
  );
  const insurance = aggregateDocGroupBadge(driver.documents, ["insurance"]);
  const registration = aggregateDocGroupBadge(driver.documents, ["registration"]);
  const identity = aggregateDocGroupBadge(driver.documents, [
    "id_card_front",
    "id_card_back",
    "id_card",
    "passport",
  ]);
  const stripe = stripeIdentityBadge(driver.stripe_identity_status);

  const groups = [
    { name: "License", ...license },
    { name: "Insurance", ...insurance },
    { name: "Registration", ...registration },
    { name: "Identity", ...identity },
    { name: "Stripe Identity", ...stripe },
  ];

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Document status">
      {groups.map((g) => (
        <span key={g.name} className="inline-flex items-center gap-1">
          <span className="text-[10px] font-medium text-slate-500">{g.name}</span>
          <DriverBadge label={g.label} tone={g.tone} />
        </span>
      ))}
    </div>
  );
}
