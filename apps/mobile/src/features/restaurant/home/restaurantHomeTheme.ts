import { Platform } from "react-native";

/** Premium Restaurant Home shell — light ops layout (map-first). */
export const RH = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  muted: "#F8FAFC",
  sidebarBg: "#FFFFFF",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  text: "#0F172A",
  textSecondary: "#64748B",
  textSoft: "#94A3B8",
  green: "#16A34A",
  greenSoft: "#DCFCE7",
  greenDark: "#15803D",
  accent: "#16A34A",
  accentSoft: "rgba(22,163,74,0.12)",
  danger: "#EF4444",
  dangerSoft: "#FEE2E2",
  warning: "#F97316",
  warningSoft: "#FFEDD5",
  online: "#22C55E",
  offline: "#EF4444",
  busy: "#D97706",
  shadow: "#0F172A",
} as const;

export const RH_SIDEBAR_WIDTH = 268;
/** Density-independent width: landscape phones (~640+) and tablets get a permanent sidebar. */
export const RH_TABLET_BREAKPOINT = 640;
export const RH_HEADER_HEIGHT = 56;

export const RH_SHADOW = {
  shadowColor: RH.shadow,
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
} as const;

export const RH_SHADOW_SOFT = {
  shadowColor: RH.shadow,
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

export const RH_BOTTOM_SAFE = Platform.OS === "android" ? 12 : 10;
