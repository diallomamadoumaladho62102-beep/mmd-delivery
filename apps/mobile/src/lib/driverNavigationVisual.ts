/**
 * Navigation conducteur — caméra Waze premium et styles route.
 */

/**
 * Cible écran du centre caméra (point de visée 28 m devant le GPS).
 * Calibré pour que la flèche (ancre GPS) reste ~82–84 % avec marge sous la base.
 */
export const NAV_ICON_SCREEN_RATIO = 0.748;

/** Trip bar (`DriverNavigationBottomBar`: padding 15+13 + ligne ~30 px). */
const TRIP_BAR_HEIGHT_RATIO = 80 / 2340;
/** Safe area basse (home indicator / barre navigation système). */
const SAFE_AREA_BOTTOM_RATIO = 32 / 2340;
/** Marge visible sous la base de la flèche. */
const ARROW_BOTTOM_SCREEN_MARGIN_RATIO = 48 / 2340;
/** Compense le GPS 28 m derrière le centre caméra (cadrage flèche, pas le look-ahead). */
const LOOK_AHEAD_SCREEN_PADDING_RATIO = 120 / 2340;

/** HUD navigation MMD (capture 1080×2340). */
const TOP_UI_RATIO = 289 / 2340;

/** Trip bar → bas fenêtre app (conservé pour compat. tests). */
const TRIP_BAR_BOTTOM_INSET_RATIO =
  TRIP_BAR_HEIGHT_RATIO + SAFE_AREA_BOTTOM_RATIO;

const HORIZONTAL_INSET = 16;

export type NavigationScreenLayout = {
  width: number;
  height: number;
  routeFutureWidth: number;
  routeTraveledWidth: number;
  cameraPaddingTop: number;
  cameraPaddingBottom: number;
  cameraPaddingLeft: number;
  cameraPaddingRight: number;
};

/** Cyan épais devant — lisibilité premium à zoom rapproché. */
export const ROUTE_FUTURE_WIDTH_RATIO = 26 / 711;
/** Vert fin derrière. */
export const ROUTE_TRAVELED_WIDTH_RATIO = 7 / 711;
export const ROUTE_FUTURE_GLOW_MULTIPLIER = 1.05;

/** Padding caméra — ancre véhicule au-dessus barre trip + marge flèche. */
export function computeNavigationScreenLayout(
  screen: { width: number; height: number },
): NavigationScreenLayout {
  const { width, height } = screen;
  const topInset = Math.round(height * TOP_UI_RATIO);
  const cameraPaddingBottom =
    Math.round(height * TRIP_BAR_HEIGHT_RATIO) +
    Math.round(height * SAFE_AREA_BOTTOM_RATIO) +
    Math.round(height * ARROW_BOTTOM_SCREEN_MARGIN_RATIO) +
    Math.round(height * LOOK_AHEAD_SCREEN_PADDING_RATIO);
  const targetAnchorY = height * NAV_ICON_SCREEN_RATIO;
  const paddingTop = Math.round(2 * targetAnchorY - height + cameraPaddingBottom);

  return {
    width,
    height,
    routeFutureWidth: width * ROUTE_FUTURE_WIDTH_RATIO,
    routeTraveledWidth: width * ROUTE_TRAVELED_WIDTH_RATIO,
    cameraPaddingTop: Math.max(topInset, paddingTop),
    cameraPaddingBottom,
    cameraPaddingLeft: HORIZONTAL_INSET,
    cameraPaddingRight: HORIZONTAL_INSET,
  };
}

/**
 * Caméra conduite — compromis Waze : fine bande d'horizon (~3–5 %), légère 3D.
 * Pitch entre la version verticale (50°) et panoramique (67°).
 */
export const NAV_CAMERA = {
  zoom: 19.32,
  zoomOpenRoad: 19.18,
  zoomTurnApproach: 19.36,
  zoomTurnTight: 19.4,
  zoomMin: 18.8,
  zoomMax: 19.45,
  pitch: 64,
  pitchOpenRoad: 62,
  pitchTurnApproach: 65,
  pitchTurn: 66,
  pitchMin: 58,
  pitchMax: 66,
} as const;

/** Point de visée légèrement devant l'ancre — regard un peu moins lointain. */
export const NAV_CAMERA_LOOK_AHEAD_METERS = 28;

export const NAV_ROUTE_FUTURE = {
  color: "#48C4E0",
  opacity: 0.98,
  glowColor: "#48C4E0",
  glowOpacity: 0.04,
  glowBlur: 0.35,
} as const;

export const NAV_ROUTE_TRAVELED = {
  color: "#2ECC71",
  opacity: 0.88,
} as const;

/** Pointe flèche → cyan démarre à la pointe (pas la base GPS). */
export const NAV_ARROW_TIP_CANVAS_RATIO = (96 - 8) / 128;
export const NAV_ARROW_TIP_AHEAD_METERS = 6;

/**
 * Décalage écran vertical de la flèche (px ref. 2340) — évite le recouvrement
 * par la barre trip React Native. N'affecte pas le GPS ni la caméra.
 */
export const NAV_ARROW_SCREEN_OFFSET_Y = -48;

export const NAV_MAP = {
  land: "#1A2838",
  road: "#6E8AA4",
  roadOpacity: 0.92,
  roadCase: "#4F677C",
  roadCaseOpacity: 0.68,
  label: "#F1F5F9",
} as const;

/** Chevron compact — mieux proportionné vs Waze. */
export const NAV_ARROW_ICON = {
  size: [
    "interpolate",
    ["linear"],
    ["zoom"],
    15,
    0.42,
    16,
    0.48,
    17,
    0.52,
    18,
    0.54,
    19,
    0.56,
  ],
  offset: [0, 0] as const,
} as const;

export const NAV_ARROW_BEARING_OFFSET = 0;

/** @deprecated Utiliser NAV_ICON_SCREEN_RATIO */
export const WAZE_ICON_BASE_SCREEN_RATIO = NAV_ICON_SCREEN_RATIO;
export const WAZE_ICON_MAP_ZONE_RATIO = 0.832;
