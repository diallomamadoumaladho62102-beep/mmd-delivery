"use client";

import type { StatusBadgeTone } from "@/lib/adminFoodOrderDisplay";

const TONE_CLASS: Record<StatusBadgeTone, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  yellow: "border-amber-200 bg-amber-50 text-amber-800",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  orange: "border-orange-200 bg-orange-50 text-orange-800",
  red: "border-red-200 bg-red-50 text-red-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

export default function FoodOrderBadge({
  label,
  tone,
}: {
  label: string;
  tone: StatusBadgeTone;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide",
        TONE_CLASS[tone],
      ].join(" ")}
    >
      {label}
    </span>
  );
}
