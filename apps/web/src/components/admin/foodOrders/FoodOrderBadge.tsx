"use client";

import { ccBadgeClass, type CcBadgeTone } from "@/components/admin/adminUi";
import type { StatusBadgeTone } from "@/lib/adminFoodOrderDisplay";

const TONE_MAP: Record<StatusBadgeTone, CcBadgeTone> = {
  green: "success",
  yellow: "warn",
  blue: "info",
  orange: "warn",
  red: "critical",
  slate: "neutral",
};

export default function FoodOrderBadge({
  label,
  tone,
}: {
  label: string;
  tone: StatusBadgeTone;
}) {
  return <span className={ccBadgeClass(TONE_MAP[tone])}>{label}</span>;
}
