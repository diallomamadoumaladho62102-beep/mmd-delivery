"use client";


import { useAdminT } from "@/i18n/useAdminT";
import {
  taxiRideStepperIndex,
  type AdminTaxiRideListItem,
} from "@/lib/adminTaxiRideDisplay";


export default function TaxiRideStatusStepper({
  ride,
}: {
  ride: AdminTaxiRideListItem;
}) {
  const { t } = useAdminT();
  const steps = [
    t("Created"),
    t("Searching"),
    t("Accepted"),
    t("En route"),
    t("Picked up"),
    t("Destination"),
    t("Completed"),
  ];

  const idx = taxiRideStepperIndex(ride);
  const canceled = idx < 0;

  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label={t("Ride progress")}>
      {canceled ? (
        <li className="text-[11px] font-semibold text-red-700">{t("Cancelled")}</li>
      ) : (
        steps.map((label, i) => {
          const done = i <= idx;
          const current = i === idx;
          return (
            <li key={label} className="flex items-center gap-1">
              {i > 0 ? (
                <span
                  className={done ? "text-slate-400" : "text-slate-200"}
                  aria-hidden
                >
                  →
                </span>
              ) : null}
              <span
                className={[
                  "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
                  current
                    ? "bg-slate-900 text-white"
                    : done
                      ? "bg-slate-100 text-slate-700"
                      : "text-slate-400",
                ].join(" ")}
              >
                {label}
              </span>
            </li>
          );
        })
      )}
    </ol>
  );
}
