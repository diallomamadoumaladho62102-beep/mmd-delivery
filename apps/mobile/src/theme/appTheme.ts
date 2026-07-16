/**
 * MMD app-wide UI tokens (Phase 10).
 * Dark-first product chrome. Navigation Mapbox keeps navigationTheme day/night.
 */

export const APP_RADIUS = {
  sm: 10,
  md: 14,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const APP_SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const APP_HIT = {
  min: 44,
  comfortable: 48,
} as const;

export const APP_MOTION = {
  fast: 140,
  base: 220,
  slow: 320,
} as const;

export const APP_TYPO = {
  title: { fontSize: 20, fontWeight: "700" as const },
  subtitle: { fontSize: 13, fontWeight: "500" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  caption: { fontSize: 12, fontWeight: "500" as const },
  button: { fontSize: 15, fontWeight: "700" as const },
} as const;

/** Canonical dark product palette — replace scattered #030712 / #0B1220 / #A78BFA. */
export const APP_COLORS = {
  bg: "#020617",
  bgElevated: "#0B1220",
  surface: "#111827",
  surfaceAlt: "#0F172A",
  border: "#1F2937",
  borderMuted: "#334155",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  textSubtle: "#CBD5E1",
  accent: "#A78BFA",
  accentStrong: "#7C3AED",
  accentSoft: "rgba(124,58,237,0.15)",
  success: "#86EFAC",
  danger: "#FCA5A5",
  dangerStrong: "#7F1D1D",
  warning: "#FCD34D",
  onAccent: "#FFFFFF",
  overlay: "rgba(0,0,0,0.6)",
} as const;

export type AppColorKey = keyof typeof APP_COLORS;

export function appColor(key: AppColorKey): string {
  return APP_COLORS[key];
}

/** Contrast-safe pairs used by shared UI (WCAG-ish dark theme checks in tests). */
export const APP_CONTRAST_PAIRS = [
  { fg: APP_COLORS.text, bg: APP_COLORS.bg, min: 7 },
  { fg: APP_COLORS.textMuted, bg: APP_COLORS.bg, min: 3 },
  { fg: APP_COLORS.onAccent, bg: APP_COLORS.accentStrong, min: 4.5 },
] as const;
