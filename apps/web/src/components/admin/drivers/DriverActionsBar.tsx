"use client";

import Link from "next/link";
import {
  driverStatusActions,
  type AdminDriverListItem,
  type DriverActionStatus,
} from "@/lib/adminDriverDisplay";

export default function DriverActionsBar({
  driver,
  canManage,
  busy,
  onStatusAction,
  onView,
}: {
  driver: AdminDriverListItem;
  canManage: boolean;
  busy: boolean;
  onStatusAction: (status: DriverActionStatus) => void;
  onView: () => void;
}) {
  const actions = driverStatusActions(driver.status, {
    canManage,
    missingCount: driver.computed_missing_requirements.length,
    userId: driver.user_id,
  });

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => {
        if (action.href) {
          return (
            <Link
              key={action.key}
              href={action.href}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {action.label}
            </Link>
          );
        }
        if (action.key === "view") {
          return (
            <button
              key={action.key}
              type="button"
              onClick={onView}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
            >
              {action.label}
            </button>
          );
        }
        if (!action.status) return null;
        const destructive =
          action.status === "rejected" ||
          action.status === "suspended" ||
          action.status === "disabled";
        return (
          <button
            key={action.key}
            type="button"
            disabled={busy || action.disabled}
            title={action.title}
            aria-label={action.label}
            onClick={() => onStatusAction(action.status!)}
            className={[
              "inline-flex h-11 items-center justify-center rounded-xl px-3 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-50",
              destructive
                ? "border border-red-300 bg-red-50 text-red-800 hover:bg-red-100"
                : "border border-slate-900 bg-slate-900 text-white hover:bg-slate-800",
            ].join(" ")}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
