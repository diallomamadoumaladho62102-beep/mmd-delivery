"use client";

import { statusStepperIndex, type AdminDriverListItem } from "@/lib/adminDriverDisplay";

const STEPS = [
  "Created",
  "Docs sent",
  "Verification",
  "Approved",
  "Active",
  "Online",
] as const;

export default function DriverStatusStepper({ driver }: { driver: AdminDriverListItem }) {
  const current = statusStepperIndex(driver);

  return (
    <ol className="flex items-center gap-1" aria-label="Driver onboarding progress">
      {STEPS.map((step, index) => {
        const done = index <= current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-1">
            <div className="flex min-w-0 flex-col items-center gap-0.5">
              <span
                className={[
                  "h-2 w-2 rounded-full",
                  done ? "bg-slate-900" : "bg-slate-300",
                ].join(" ")}
              />
              <span
                className={[
                  "truncate text-[9px] font-medium",
                  done ? "text-slate-700" : "text-slate-400",
                ].join(" ")}
              >
                {step}
              </span>
            </div>
            {index < STEPS.length - 1 ? (
              <div
                className={[
                  "mb-3 h-px flex-1",
                  index < current ? "bg-slate-900" : "bg-slate-200",
                ].join(" ")}
                aria-hidden
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
