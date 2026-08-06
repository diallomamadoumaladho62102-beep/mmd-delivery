"use client";

import type { DocBadgeTone } from "@/lib/adminDriverDisplay";

const TONE: Record<DocBadgeTone, string> = {
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  yellow: "border-amber-200 bg-amber-50 text-amber-800",
  orange: "border-orange-200 bg-orange-50 text-orange-800",
  red: "border-red-200 bg-red-50 text-red-800",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

export default function DriverBadge({
  label,
  tone,
}: {
  label: string;
  tone: DocBadgeTone;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        TONE[tone],
      ].join(" ")}
    >
      {label}
    </span>
  );
}
