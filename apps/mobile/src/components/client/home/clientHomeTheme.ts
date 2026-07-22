import { Platform, StyleSheet } from "react-native";

/** Official Client Home light theme — mockup reference. */
export const V4 = {
  bg: "#FFFFFF",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  cardSecondary: "#F8FAFC",
  mutedBg: "#F8FAFC",
  green: "#16A34A",
  greenSoft: "#DCFCE7",
  greenDark: "#15803D",
  borderGreen: "rgba(22,163,74,0.35)",
  purple: "#7C3AED",
  purpleSoft: "#F3E8FF",
  yellow: "#EAB308",
  yellowSoft: "#FEF9C3",
  taxi: "#CA8A04",
  food: "#16A34A",
  delivery: "#7C3AED",
  marketplace: "#059669",
  textPrimary: "#0F172A",
  textSecondary: "#64748B",
  textSoft: "#94A3B8",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  danger: "#EF4444",
  searchIcon: "#3B82F6",
} as const;

export const V4_RADIUS = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
} as const;

export const V4_SHADOW = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
} as const;

export const V4_SHADOW_SOFT = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

export const V4_BOTTOM_SAFE = Platform.OS === "android" ? 108 : 96;

export const v4Styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: V4.bg,
  },
  root: {
    flex: 1,
    backgroundColor: V4.bg,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: V4_BOTTOM_SAFE + 20,
  },
});
