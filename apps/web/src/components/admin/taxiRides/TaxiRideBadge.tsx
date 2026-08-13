"use client";

import { ccBadgeClass, type CcBadgeTone } from "@/components/admin/adminUi";
import type { TaxiBadgeTone } from "@/lib/adminTaxiRideDisplay";

const TONE_MAP: Record<TaxiBadgeTone, CcBadgeTone> = {
  green: "success",
  yellow: "warn",
  blue: "info",
  purple: "ai",
  orange: "warn",
  red: "critical",
  slate: "neutral",
};

const DOT_CLASS: Record<CcBadgeTone, string> = {
  success: "bg-[var(--cc-success)]",
  warn: "bg-[var(--cc-warn)]",
  info: "bg-[var(--cc-info)]",
  critical: "bg-[var(--cc-critical)]",
  neutral: "bg-[var(--cc-disabled)]",
  ai: "bg-[var(--cc-ai)]",
};

export default function TaxiRideBadge({
  label,
  tone,
}: {
  label: string;
  tone: TaxiBadgeTone;
}) {
  const mapped = TONE_MAP[tone];
  return (
    <span className={ccBadgeClass(mapped)}>
      <span
        className={["h-1.5 w-1.5 shrink-0 rounded-full", DOT_CLASS[mapped]].join(" ")}
        aria-hidden
      />
      {label}
    </span>
  );
}
