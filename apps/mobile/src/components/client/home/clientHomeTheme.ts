import { Platform, StyleSheet } from "react-native";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD,
  MMD_GOLD_DARK,
  MMD_WHITE,
} from "../../../theme/mmdUi";

/** Client Home tokens — Figma Customer App / Client Home (m1YPra9RLUz38tGTPmYczj). */
export const V4 = {
  bg: MMD_BLUE,
  surface: "rgba(255,255,255,0.05)",
  card: MMD_WHITE,
  cardSecondary: "rgba(255,255,255,0.08)",
  mutedBg: "rgba(255,255,255,0.08)",
  green: "#1AA633",
  greenSoft: "rgba(26,166,51,0.2)",
  greenDark: "#15803D",
  borderGreen: "rgba(26,166,51,0.45)",
  purple: "#7C3AED",
  purpleSoft: "rgba(124,58,237,0.2)",
  yellow: MMD_GOLD_DARK,
  yellowSoft: "rgba(218,170,32,0.2)",
  taxi: "#E51A1A",
  food: "#1AA633",
  delivery: "#FFCC00",
  marketplace: "#1AA633",
  textPrimary: MMD_WHITE,
  textOnCard: "#1A1A1A",
  textSecondary: "rgba(255,255,255,0.85)",
  textSoft: "rgba(255,255,255,0.65)",
  border: "rgba(255,255,255,0.3)",
  borderStrong: MMD_WHITE,
  danger: "#EF4444",
  searchIcon: "#1A1A1A",
  searchBar: "#00998C",
  navBg: "#001F59",
  creditCardBg: MMD_WHITE,
  creditCardText: "#1A1A1A",
  gold: MMD_GOLD,
  goldDark: MMD_GOLD_DARK,
  font: MMD_FONT,
} as const;

export const V4_RADIUS = {
  sm: 10,
  md: 12,
  lg: 14,
  xl: 20,
  pill: 999,
} as const;

export const V4_SHADOW = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.2,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 4,
} as const;

export const V4_SHADOW_SOFT = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.12,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

export const V4_BOTTOM_SAFE = Platform.OS === "android" ? 108 : 96;

export const v4Styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: V4.bg,
  },
  safe: {
    flex: 1,
    backgroundColor: V4.bg,
  },
  scrollContent: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: V4_BOTTOM_SAFE,
  },
});
