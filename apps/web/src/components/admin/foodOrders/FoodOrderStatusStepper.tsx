"use client";

import {
  FOOD_ORDER_STATUS_STEPS,
  statusStepperIndex,
} from "@/lib/adminFoodOrderDisplay";

const STEP_LABELS: Record<(typeof FOOD_ORDER_STATUS_STEPS)[number], string> = {
  pending: "Pending",
  accepted: "Accepted",
  prepared: "Prep",
  ready: "Ready",
  dispatched: "En route",
  delivered: "Done",
};

export default function FoodOrderStatusStepper({
  status,
}: {
  status: string | null | undefined;
}) {
  const current = statusStepperIndex(status);
  const canceled = current < 0;

  if (canceled) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-700">
        Order cancelled — pipeline stopped
      </div>
    );
  }

  return (
    <ol className="flex items-center gap-1" aria-label="Order status progress">
      {FOOD_ORDER_STATUS_STEPS.map((step, index) => {
        const done = index <= current;
        const active = index === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-1">
            <div className="flex min-w-0 flex-col items-center gap-0.5">
              <span
                className={[
                  "h-2 w-2 rounded-full",
                  done ? "bg-slate-900" : "bg-slate-300",
                  active ? "ring-2 ring-slate-900/20" : "",
                ].join(" ")}
              />
              <span
                className={[
                  "truncate text-[9px] font-medium",
                  done ? "text-slate-700" : "text-slate-400",
                ].join(" ")}
              >
                {STEP_LABELS[step]}
              </span>
            </div>
            {index < FOOD_ORDER_STATUS_STEPS.length - 1 ? (
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
