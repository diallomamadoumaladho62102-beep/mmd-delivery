import { Platform, ViewStyle } from "react-native";
import {
  MMD_BLUE,
  MMD_GOLD,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_TEXT,
} from "../../../theme/mmdUi";

/** Figma Restaurant Command Center — mmdUi glass on MMD_BLUE. */
export const CC = {
  bg: MMD_BLUE,
  bgElevated: "rgba(0, 43, 140, 0.55)",
  glass: "rgba(255,255,255,0.07)",
  glassBorder: "rgba(255,255,255,0.13)",
  glassBorderGold: "rgba(212,175,55,0.35)",
  purple: "#7C3AED",
  purpleLight: "#A78BFA",
  purpleGlow: "rgba(167,139,250,0.22)",
  purpleDeep: "rgba(76,29,149,0.45)",
  gold: MMD_GOLD,
  goldDim: "rgba(245,158,11,0.15)",
  green: MMD_TAXI_GREEN,
  greenDim: "rgba(34,197,94,0.1)",
  red: "#F87171",
  redDim: "rgba(248,113,113,0.16)",
  blue: "#60A5FA",
  blueDim: "rgba(96,165,250,0.14)",
  orange: "#FB923C",
  orangeDim: "rgba(251,146,60,0.14)",
  textPrimary: MMD_TEXT,
  textSecondary: "rgba(226,232,240,0.72)",
  textMuted: "#94A3B8",
  heroGlowGold: "rgba(251,191,36,0.14)",
  heroGlowPurple: "rgba(167,139,250,0.18)",
  mapFrameGlow: "rgba(96,165,250,0.28)",
  cta: MMD_TAXI_GREEN,
  brandGold: MMD_GOLD_CLASSIC,
  shadow: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.15,
      shadowRadius: 18,
    },
    android: { elevation: 6 },
    default: {},
  }) as ViewStyle,
  heroShadow: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.15,
      shadowRadius: 24,
    },
    android: { elevation: 8 },
    default: {},
  }) as ViewStyle,
};

export const STATUS_COLORS: Record<string, string> = {
  pending: "#F97316",
  accepted: "#60A5FA",
  prepared: "#818CF8",
  ready: "#4ADE80",
  dispatched: "#38BDF8",
  delivered: "#A78BFA",
  completed: "#34D399",
  canceled: "#F87171",
};

export const LIVE_OPS_STATUS = {
  arrived: {
    color: CC.green,
    tint: "rgba(34,197,94,0.07)",
    border: "rgba(34,197,94,0.2)",
    dot: "🟢",
  },
  approaching: {
    color: CC.orange,
    tint: CC.orangeDim,
    border: "rgba(251,146,60,0.55)",
    dot: "🟠",
  },
  en_route: {
    color: CC.blue,
    tint: CC.blueDim,
    border: "rgba(96,165,250,0.55)",
    dot: "🔵",
  },
  new_order: {
    color: CC.purpleLight,
    tint: "rgba(167,139,250,0.07)",
    border: "rgba(167,139,250,0.2)",
    dot: "🟣",
  },
  attention: {
    color: CC.red,
    tint: CC.redDim,
    border: "rgba(239,68,68,0.55)",
    dot: "🔴",
  },
} as const;

export type LiveOpsVisualVariant = keyof typeof LIVE_OPS_STATUS;

export function glassCardStyle(variant: "default" | "hero" | "gold" | "map" = "default"): ViewStyle {
  const borderColor =
    variant === "gold"
      ? CC.glassBorderGold
      : variant === "hero"
        ? CC.glassBorder
        : variant === "map"
          ? CC.glassBorder
          : CC.glassBorder;

  return {
    borderRadius: variant === "hero" ? 16 : variant === "map" ? 16 : 16,
    backgroundColor: CC.glass,
    borderWidth: 1,
    borderColor,
    overflow: "hidden",
    ...(variant === "hero" ? CC.heroShadow : CC.shadow),
  };
}

export function liveOpsCardStyle(variant: LiveOpsVisualVariant): ViewStyle {
  const status = LIVE_OPS_STATUS[variant];
  return {
    width: 300,
    marginRight: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: status.tint,
    borderWidth: 1,
    borderColor: status.border,
    borderLeftWidth: 5,
    borderLeftColor: status.color,
    overflow: "hidden",
    ...CC.shadow,
  };
}
