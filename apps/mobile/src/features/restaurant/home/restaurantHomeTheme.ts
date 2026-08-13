import { Platform } from "react-native";
import {
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_GOLD_CLASSIC,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../../../theme/mmdUi";

/** Figma Restaurant Home Lot 2 — blue chrome + glass map overlays. */
export const RH = {
  bg: MMD_BLUE,
  surface: MMD_BLUE,
  muted: "rgba(255,255,255,0.15)",
  sidebarBg: MMD_BLUE,
  border: MMD_CARD_BORDER,
  borderStrong: "rgba(255,255,255,0.2)",
  text: MMD_TEXT,
  textSecondary: "rgba(255,255,255,0.7)",
  textSoft: "rgba(255,255,255,0.55)",
  green: MMD_TAXI_GREEN,
  greenSoft: "rgba(34,197,94,0.16)",
  greenDark: MMD_TAXI_GREEN,
  accent: MMD_TAXI_GREEN,
  accentSoft: "rgba(34,197,94,0.12)",
  danger: "#EF4444",
  dangerSoft: "rgba(239,68,68,0.18)",
  warning: "#D97706",
  warningSoft: "rgba(217,119,6,0.18)",
  online: MMD_TAXI_GREEN,
  offline: "#EF4444",
  busy: "#D97706",
  brandGold: MMD_GOLD_CLASSIC,
  glass: "rgba(255,255,255,0.15)",
  glassInner: MMD_GLASS,
  white: MMD_WHITE,
  shadow: "#000000",
} as const;

export const RH_SIDEBAR_WIDTH = 268;
/** Density-independent width: landscape phones (~640+) and tablets get a permanent sidebar. */
export const RH_TABLET_BREAKPOINT = 640;
export const RH_HEADER_HEIGHT = 56;

export const RH_SHADOW = {
  shadowColor: RH.shadow,
  shadowOpacity: 0.15,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 4,
} as const;

export const RH_SHADOW_SOFT = {
  shadowColor: RH.shadow,
  shadowOpacity: 0.12,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

export const RH_BOTTOM_SAFE = Platform.OS === "android" ? 12 : 10;
