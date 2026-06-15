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
  gold: "#FBBF24",
  goldDim: "rgba(245,158,11,0.15)",
  green: "#4ADE80",
  greenDim: "rgba(34,197,94,0.18)",
  red: "#F87171",
  redDim: "rgba(239,68,68,0.16)",
  blue: "#60A5FA",
  orange: "#FB923C",
  textPrimary: "#F8FAFC",
  textSecondary: "rgba(226,232,240,0.72)",
  textMuted: "rgba(148,163,184,0.92)",
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

export function glassCardStyle(variant: "default" | "hero" | "gold" = "default"): ViewStyle {
  const borderColor =
    variant === "gold" ? CC.glassBorderGold : variant === "hero" ? CC.purpleGlow : CC.glassBorder;

  return {
    borderRadius: variant === "hero" ? 24 : 20,
    backgroundColor: variant === "hero" ? "rgba(255,255,255,0.07)" : CC.glass,
    borderWidth: 1,
    borderColor,
    overflow: "hidden",
    ...CC.shadow,
  };
}
