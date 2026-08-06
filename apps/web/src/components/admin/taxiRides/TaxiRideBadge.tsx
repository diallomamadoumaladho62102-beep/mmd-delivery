"use client";

import type { TaxiBadgeTone } from "@/lib/adminTaxiRideDisplay";

const TONE: Record<TaxiBadgeTone, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  yellow: "border-amber-200 bg-amber-50 text-amber-900",
  blue: "border-sky-200 bg-sky-50 text-sky-800",
  purple: "border-violet-200 bg-violet-50 text-violet-800",
  orange: "border-orange-200 bg-orange-50 text-orange-900",
  red: "border-red-200 bg-red-50 text-red-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

const DOT: Record<TaxiBadgeTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  blue: "bg-sky-500",
  purple: "bg-violet-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  slate: "bg-slate-400",
};

export default function TaxiRideBadge({
  label,
  tone,
}: {
  label: string;
  tone: TaxiBadgeTone;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        TONE[tone],
      ].join(" ")}
    >
      <span className={["h-1.5 w-1.5 shrink-0 rounded-full", DOT[tone]].join(" ")} aria-hidden />
      {label}
    </span>
  );
}
