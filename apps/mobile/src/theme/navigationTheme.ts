/**
 * MMD navigation design system — centralized tokens for all on-map controls,
 * safety badges and contextual panels. Avoids magic values scattered across
 * components and provides coherent day/night palettes tuned for contrast over
 * the Mapbox streets style (light) and low-light driving (dark).
 */

export type NavColorScheme = "day" | "night";

export const NAV_RADIUS = {
  sm: 12,
  md: 16,
  lg: 22,
  pill: 999,
  circle: 999,
} as const;

export const NAV_SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
} as const;

/** Minimum accessible tactile target (>= 44 iOS / 48 Android HIG). */
export const NAV_HIT = {
  button: 52,
  buttonCompact: 44,
  iconSm: 18,
  iconMd: 22,
  iconLg: 26,
} as const;

/** Clean, layered elevations (no heavy shadows). */
export const NAV_ELEVATION = {
  low: {
    shadowColor: "#000000",
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  medium: {
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  high: {
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

export const NAV_MOTION = {
  fast: 140,
  base: 220,
  slow: 320,
  pressScale: 0.94,
} as const;

export const NAV_TYPO = {
  badgeValue: { fontSize: 20, fontWeight: "900" as const },
  badgeLabel: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 0.3 },
  panelTitle: { fontSize: 15, fontWeight: "900" as const },
  panelDistance: { fontSize: 13, fontWeight: "800" as const },
  panelCaption: { fontSize: 11, fontWeight: "600" as const },
} as const;

type NavPalette = {
  surface: string;
  surfaceElevated: string;
  surfaceBorder: string;
  onSurface: string;
  onSurfaceMuted: string;
  accent: string;
  accentOn: string;
  active: string;
  activeOn: string;
  danger: string;
  dangerSurface: string;
  warning: string;
  warningSurface: string;
  overlayScrim: string;
};

const DAY_PALETTE: NavPalette = {
  surface: "rgba(255,255,255,0.96)",
  surfaceElevated: "#FFFFFF",
  surfaceBorder: "rgba(15,23,42,0.10)",
  onSurface: "#0F172A",
  onSurfaceMuted: "#5B6472",
  accent: "#0B84FF",
  accentOn: "#FFFFFF",
  active: "#00B34D",
  activeOn: "#FFFFFF",
  danger: "#DC2626",
  dangerSurface: "#FEE2E2",
  warning: "#B45309",
  warningSurface: "#FEF3C7",
  overlayScrim: "rgba(15,23,42,0.06)",
};

const NIGHT_PALETTE: NavPalette = {
  surface: "rgba(17,20,28,0.94)",
  surfaceElevated: "#151922",
  surfaceBorder: "rgba(255,255,255,0.12)",
  onSurface: "#F8FAFC",
  onSurfaceMuted: "#9CA6B8",
  accent: "#48C4E0",
  accentOn: "#04121A",
  active: "#22C55E",
  activeOn: "#04140A",
  danger: "#F87171",
  dangerSurface: "rgba(69,10,10,0.92)",
  warning: "#FBBF24",
  warningSurface: "rgba(69,26,3,0.92)",
  overlayScrim: "rgba(0,0,0,0.28)",
};

export function navPalette(scheme: NavColorScheme): NavPalette {
  return scheme === "day" ? DAY_PALETTE : NIGHT_PALETTE;
}

/** Fixed, recognizable colors for safety categories (consistent day & night). */
export const SAFETY_COLORS = {
  speed_camera: { bg: "#1F2937", ring: "#F59E0B", icon: "#FDE68A" },
  red_light_camera: { bg: "#1F2937", ring: "#EF4444", icon: "#FCA5A5" },
  stop_sign: { bg: "#B91C1C", ring: "#FFFFFF", icon: "#FFFFFF" },
  school_zone: { bg: "#B45309", ring: "#FCD34D", icon: "#FEF3C7" },
  speed_limit: { bg: "#FFFFFF", ring: "#DC2626", icon: "#111827" },
  overspeed: { bg: "#DC2626", ring: "#991B1B", icon: "#FFFFFF" },
} as const;
