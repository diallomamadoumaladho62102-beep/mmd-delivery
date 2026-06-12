import { Platform, StyleSheet } from "react-native";

export const V4 = {
  bg: "#050B18",
  card: "#0B1528",
  cardSecondary: "#101B33",
  green: "#00D95F",
  purple: "#7B61FF",
  textPrimary: "#FFFFFF",
  textSecondary: "#AAB3C5",
  border: "rgba(255,255,255,0.10)",
  borderGreen: "rgba(0,217,95,0.35)",
  glass: "rgba(11,21,40,0.88)",
} as const;

export const V4_RADIUS = {
  sm: 14,
  md: 22,
  lg: 28,
  xl: 32,
} as const;

export const V4_SHADOW = {
  shadowColor: "#000",
  shadowOpacity: 0.35,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 12 },
  elevation: 8,
} as const;

export const V4_BOTTOM_SAFE = Platform.OS === "android" ? 104 : 88;

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
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: V4_BOTTOM_SAFE + 24,
  },
});
