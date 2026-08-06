"use client";

import Link from "next/link";
import {
  rideStatusActions,
  type AdminTaxiRideListItem,
} from "@/lib/adminTaxiRideDisplay";

/** Primary quick actions (same set as the ⋯ menu, for keyboard/scanability). */
export default function TaxiRideActionsBar({
  ride,
}: {
  ride: AdminTaxiRideListItem;
}) {
  const actions = rideStatusActions(ride).slice(0, 3);

  return (
    <div className="flex flex-wrap gap-2" aria-label="Ride actions">
      {actions.map((action) => (
        <Link
          key={action.key}
          href={action.href}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          {action.label}
        </Link>
      ))}
    </div>
  );
}
