import { Platform, ViewStyle } from "react-native";

export const CC = {
  bg: "#030712",
  bgElevated: "#0B0F1A",
  glass: "rgba(255,255,255,0.06)",
  glassBorder: "rgba(167,139,250,0.22)",
  glassBorderGold: "rgba(245,158,11,0.28)",
  purple: "#7C3AED",
  purpleLight: "#A78BFA",
  purpleGlow: "rgba(124,58,237,0.35)",
  purpleDeep: "rgba(76,29,149,0.55)",
  gold: "#FBBF24",
  goldDim: "rgba(245,158,11,0.15)",
  green: "#4ADE80",
  greenDim: "rgba(34,197,94,0.18)",
  red: "#F87171",
  redDim: "rgba(239,68,68,0.16)",
  blue: "#60A5FA",
  blueDim: "rgba(96,165,250,0.14)",
  orange: "#FB923C",
  orangeDim: "rgba(251,146,60,0.14)",
  textPrimary: "#F8FAFC",
  textSecondary: "rgba(226,232,240,0.72)",
  textMuted: "rgba(148,163,184,0.92)",
  heroGlowGold: "rgba(251,191,36,0.14)",
  heroGlowPurple: "rgba(124,58,237,0.22)",
  mapFrameGlow: "rgba(96,165,250,0.28)",
  shadow: Platform.select({
    ios: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.35,
      shadowRadius: 16,
    },
    android: { elevation: 8 },
    default: {},
  }) as ViewStyle,
  heroShadow: Platform.select({
    ios: {
      shadowColor: "#7C3AED",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.45,
      shadowRadius: 24,
    },
    android: { elevation: 12 },
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
    tint: CC.greenDim,
    border: "rgba(34,197,94,0.55)",
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
    tint: CC.purpleGlow,
    border: "rgba(167,139,250,0.55)",
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
        ? CC.glassBorderGold
        : variant === "map"
          ? CC.mapFrameGlow
          : CC.glassBorder;

  return {
    borderRadius: variant === "hero" ? 28 : variant === "map" ? 24 : 20,
    backgroundColor:
      variant === "hero" ? "rgba(255,255,255,0.08)" : variant === "map" ? CC.bgElevated : CC.glass,
    borderWidth: variant === "map" ? 1.5 : 1,
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
    padding: 18,
    borderRadius: 24,
    backgroundColor: status.tint,
    borderWidth: 1.5,
    borderColor: status.border,
    borderLeftWidth: 5,
    borderLeftColor: status.color,
    overflow: "hidden",
    ...CC.shadow,
  };
}
