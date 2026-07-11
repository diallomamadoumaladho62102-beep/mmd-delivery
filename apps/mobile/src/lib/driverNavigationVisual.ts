/**
 * Navigation conducteur — caméra Waze premium et styles route.
 */

/**
 * Cible écran du centre caméra (point de visée 28 m devant le GPS).
 * Calibré pour ancrage véhicule ~62–64 % (≈36–38 % depuis le bas) — plus de route visible devant, style Waze.
 */
export const NAV_ICON_SCREEN_RATIO = 0.632;

/** Trip bar (`DriverNavigationBottomBar`: padding 15+13 + ligne ~30 px). */
export const TRIP_BAR_HEIGHT_RATIO = 80 / 2340;
/** Safe area basse (home indicator / barre navigation système). */
export const SAFE_AREA_BOTTOM_RATIO = 32 / 2340;
/** Barre trip ETA visible (padding + texte, ref. Pixel 2340). */
export const TRIP_BAR_VISIBLE_HEIGHT_RATIO = 58 / 2340;
export const SPEED_CLUSTER_LEFT_RATIO = 12 / 1080;
export const SPEED_LIMIT_SIZE_RATIO = 46 / 1080;
export const SPEEDOMETER_SIZE_RATIO = 60 / 1080;
export const SPEED_CLUSTER_GAP_RATIO = 12 / 2340;
/** Toast « Puis… » juste au-dessus barre trip (ordre bas → haut : trip, toast, vitesse). */
export const TOAST_ABOVE_TRIP_RATIO = 10 / 2340;
/** Espace toast ↔ cluster vitesse. */
export const TOAST_CLUSTER_GAP_RATIO = 14 / 2340;
/** Espace cluster vitesse ↔ zone libre véhicule. */
export const CLUSTER_VEHICLE_GAP_RATIO = 18 / 2340;
/** Hauteur estimée toast 2 lignes (ref. Pixel 2340). */
export const TOAST_EST_HEIGHT_RATIO = 52 / 2340;
/** Ancre visuelle flèche avec pitch 3D (sous l'ancre caméra). */
export const WAZE_ICON_MAP_ZONE_RATIO = 0.832;
/** Hauteur flèche à l'écran (ref. 2340). */
export const VEHICLE_ICON_HEIGHT_RATIO = 92 / 2340;
/** Marge autour de la flèche — aucun overlay ne doit empiéter. */
export const VEHICLE_CLEAR_MARGIN_RATIO = 22 / 2340;
/** Demi-largeur zone horizontale véhicule (ref. 1080). */
export const VEHICLE_CLEAR_HALF_WIDTH_RATIO = 118 / 1080;
/** @deprecated Remplacé par computeNavigationBottomStack(). */
export const THEN_TOAST_ABOVE_CLUSTER_RATIO = TOAST_CLUSTER_GAP_RATIO;
/** @deprecated Remplacé par computeNavigationBottomStack(). */
export const SPEED_CLUSTER_TRIP_MARGIN_RATIO = 26 / 2340;
/** Minimum absolu pour petits écrans (iPhone SE). */
export const SPEED_CLUSTER_BOTTOM_MIN_PX = 62;
/** Marge visible sous la base de la flèche. */
const ARROW_BOTTOM_SCREEN_MARGIN_RATIO = 48 / 2340;
/** Compense le GPS 28 m derrière le centre caméra (cadrage flèche, pas le look-ahead). */
const LOOK_AHEAD_SCREEN_PADDING_RATIO = 100 / 2340;

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

export type SpeedClusterLayout = {
  bottom: number;
  left: number;
  limitSize: number;
  speedSize: number;
  gap: number;
};

export type ThenToastLayout = {
  bottom: number;
  left: number;
  maxWidth: number;
  estimatedHeight: number;
};

export type NavigationBottomStack = {
  toast: ThenToastLayout;
  speedCluster: SpeedClusterLayout;
  /** Borne basse (px depuis le bas écran) sous laquelle aucun overlay ne doit monter. */
  vehicleZoneBottom: number;
};

function clusterContentHeight(
  cluster: Pick<SpeedClusterLayout, "limitSize" | "speedSize" | "gap">,
  hasSpeedLimit: boolean,
): number {
  return (hasSpeedLimit ? cluster.limitSize + cluster.gap : 0) + cluster.speedSize;
}

function estimateToastHeight(height: number): number {
  return Math.max(32, Math.round(height * TOAST_EST_HEIGHT_RATIO));
}

/** Ratio Y visuel flèche — pitch 3D atténué sur petits écrans. */
function computeVehicleVisualRatio(height: number): number {
  if (height <= 700) {
    return NAV_ICON_SCREEN_RATIO + 0.055;
  }
  if (height <= 900) {
    return NAV_ICON_SCREEN_RATIO + 0.12;
  }
  return WAZE_ICON_MAP_ZONE_RATIO;
}

/** Zone basse réservée à la flèche (pitch 3D) — px depuis le bas écran. */
export function computeVehicleZoneBottom(height: number): number {
  const pitchBlend = Math.min(1, height / 852);
  const iconH = Math.round(height * VEHICLE_ICON_HEIGHT_RATIO * pitchBlend);
  const margin = Math.round(height * VEHICLE_CLEAR_MARGIN_RATIO);
  const zoneFromTop = height * computeVehicleVisualRatio(height);
  return Math.round(height - zoneFromTop + iconH + margin);
}

/** Empilement bas : trip → toast → vitesse, sans empiéter sur la flèche. */
export function computeNavigationBottomStack(
  screen: { width: number; height: number },
  hasSpeedLimit: boolean,
): NavigationBottomStack {
  const { width, height } = screen;
  const limitSize = Math.max(40, Math.round(width * SPEED_LIMIT_SIZE_RATIO));
  const speedSize = Math.max(50, Math.round(width * SPEEDOMETER_SIZE_RATIO));
  const gap = Math.max(6, Math.round(height * SPEED_CLUSTER_GAP_RATIO));
  const left = Math.max(10, Math.round(width * SPEED_CLUSTER_LEFT_RATIO));
  const clusterBase: SpeedClusterLayout = { bottom: 0, left, limitSize, speedSize, gap };

  const tripBarPx = Math.round(height * TRIP_BAR_HEIGHT_RATIO);
  const toastTripGap = Math.max(6, Math.round(height * TOAST_ABOVE_TRIP_RATIO));
  const toastClusterGap = Math.max(8, Math.round(height * TOAST_CLUSTER_GAP_RATIO));
  const clusterVehicleGap = Math.max(10, Math.round(height * CLUSTER_VEHICLE_GAP_RATIO));
  const toastHeight = estimateToastHeight(height);
  const vehicleZoneBottom = computeVehicleZoneBottom(height);
  const clusterHeight = clusterContentHeight(clusterBase, hasSpeedLimit);

  const toastBottom = Math.max(8, tripBarPx + toastTripGap);
  let clusterBottom = toastBottom + toastHeight + toastClusterGap;

  const clusterTop = clusterBottom + clusterHeight;
  const maxClusterTop = vehicleZoneBottom - clusterVehicleGap;
  if (clusterTop > maxClusterTop) {
    clusterBottom = Math.max(
      toastBottom + toastHeight + 6,
      maxClusterTop - clusterHeight,
    );
  }

  clusterBottom = Math.max(
    height <= 700 ? 44 : SPEED_CLUSTER_BOTTOM_MIN_PX,
    clusterBottom,
  );

  const centerX = width / 2;
  const clearHalf = Math.round(width * VEHICLE_CLEAR_HALF_WIDTH_RATIO);
  const toastLeft = left;
  const toastMaxWidth = Math.max(
    120,
    Math.round(centerX - clearHalf - toastLeft - 10),
  );

  return {
    toast: {
      bottom: toastBottom,
      left: toastLeft,
      maxWidth: toastMaxWidth,
      estimatedHeight: toastHeight,
    },
    speedCluster: { ...clusterBase, bottom: clusterBottom },
    vehicleZoneBottom,
  };
}

/** Panneau limite + compteur — empilé au-dessus du toast, sous la flèche. */
export function computeSpeedClusterLayout(
  screen: { width: number; height: number },
  hasSpeedLimit = true,
): SpeedClusterLayout {
  return computeNavigationBottomStack(screen, hasSpeedLimit).speedCluster;
}

/** Toast « Puis… » — sous le cluster vitesse, au-dessus barre trip, marge gauche. */
export function computeThenToastLayout(
  screen: { width: number; height: number },
  hasSpeedLimit: boolean,
): ThenToastLayout {
  return computeNavigationBottomStack(screen, hasSpeedLimit).toast;
}

/** @deprecated Utiliser computeThenToastLayout(). */
export function computeThenToastBottom(
  screen: { width: number; height: number },
  hasSpeedLimit: boolean,
): number {
  return computeThenToastLayout(screen, hasSpeedLimit).bottom;
}

/**
 * Mesures pixel — image référence (472×1024 px).
 * Source: scripts/measure-navigation-proportions.mjs (2026-06-30).
 */
export const REF_NAV_MEASURE = {
  screenWidth: 472,
  screenHeight: 1024,
  routeMainWidthPx: 19,
  routeGreenWidthPx: 19,
  routeCyanWidthPx: 20,
  vehicleFullWidthPx: 44,
  vehicleFullHeightPx: 44,
  routeWidthRatio: 19 / 472,
  vehicleWidthRatio: 44 / 472,
  iconToRouteRatio: 44 / 19,
  vehicleScreenRatioY: 649.5 / 1024,
  glowDiameterPx: 331,
  haloDiameterPx: 155,
  altRouteWidthPx: 26,
} as const;

/**
 * Calibrage visuel progressif — dimensions écran uniquement.
 * N'affecte pas GPS, recalcul, split vert/cyan, ETA, instructions, HUD.
 */
export const NAV_VISUAL_CALIB = {
  /** Décalage zoom caméra (négatif = plus de carte Mapbox visible). */
  zoomOffset: -1.85,
  /** Multiplicateur largeur route vert + cyan (px écran). */
  routeWidthScale: 0.58,
  /** Multiplicateur largeur glow route (px écran). */
  glowWidthScale: 0.58,
  /** Multiplicateur largeur icône véhicule (px écran). */
  iconWidthScale: 0.68,
  /** Multiplicateur iconOffset visuel — masque jonction proportionnel à l'icône. */
  iconOffsetScale: 0.68,
} as const;

/** Largeur route cyan/vert — ratio référence × calibrage visuel. */
export const ROUTE_LINE_WIDTH_RATIO =
  REF_NAV_MEASURE.routeWidthRatio * NAV_VISUAL_CALIB.routeWidthScale;
/** Largeur glow route — calibrage visuel indépendant. */
export const ROUTE_GLOW_WIDTH_RATIO =
  REF_NAV_MEASURE.routeWidthRatio * NAV_VISUAL_CALIB.glowWidthScale;
/** @deprecated Alias — même largeur cyan et vert. */
export const ROUTE_FUTURE_WIDTH_RATIO = ROUTE_LINE_WIDTH_RATIO;
/** @deprecated Alias — même largeur cyan et vert. */
export const ROUTE_TRAVELED_WIDTH_RATIO = ROUTE_LINE_WIDTH_RATIO;
export const ROUTE_FUTURE_GLOW_MULTIPLIER = 1.0;

/** Insets réels de l'appareil (react-native-safe-area-context). */
export type NavigationSafeAreaInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

/** Padding caméra — ancre véhicule au-dessus barre trip + marge flèche. */
export function computeNavigationScreenLayout(
  screen: { width: number; height: number },
  insets?: NavigationSafeAreaInsets,
): NavigationScreenLayout {
  const { width, height } = screen;
  const safeTop = Math.max(0, insets?.top ?? 0);
  const safeBottom = Math.max(0, insets?.bottom ?? 0);
  const safeLeft = Math.max(0, insets?.left ?? 0);
  const safeRight = Math.max(0, insets?.right ?? 0);

  const topInset = Math.round(height * TOP_UI_RATIO);
  const cameraPaddingBottom =
    Math.round(height * TRIP_BAR_HEIGHT_RATIO) +
    Math.round(height * SAFE_AREA_BOTTOM_RATIO) +
    Math.round(height * ARROW_BOTTOM_SCREEN_MARGIN_RATIO) +
    Math.round(height * LOOK_AHEAD_SCREEN_PADDING_RATIO) +
    safeBottom;
  const targetAnchorY = height * NAV_ICON_SCREEN_RATIO;
  const paddingTop = Math.round(2 * targetAnchorY - height + cameraPaddingBottom);

  return {
    width,
    height,
    routeFutureWidth: width * ROUTE_LINE_WIDTH_RATIO,
    routeTraveledWidth: width * ROUTE_LINE_WIDTH_RATIO,
    cameraPaddingTop: Math.max(topInset, paddingTop) + safeTop,
    cameraPaddingBottom,
    cameraPaddingLeft: HORIZONTAL_INSET + safeLeft,
    cameraPaddingRight: HORIZONTAL_INSET + safeRight,
  };
}

/**
 * Caméra conduite — compromis Waze : fine bande d'horizon (~3–5 %), légère 3D.
 * Pitch entre la version verticale (50°) et panoramique (67°).
 */
const _navZoom = (base: number) => base + NAV_VISUAL_CALIB.zoomOffset;

export const NAV_CAMERA = {
  zoom: _navZoom(19.32),
  zoomOpenRoad: _navZoom(19.18),
  zoomTurnApproach: _navZoom(19.36),
  zoomTurnTight: _navZoom(19.4),
  zoomMin: _navZoom(18.8),
  zoomMax: _navZoom(19.45),
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
  glowOpacity: 0,
  glowBlur: 0,
} as const;

export const NAV_ROUTE_TRAVELED = {
  color: "#2ECC71",
  opacity: 0.88,
} as const;

/** Pointe flèche → cyan (canvas 128, tip y=70, forme 112×58). */
export const NAV_ARROW_TIP_CANVAS_RATIO = (128 - 70) / 128;
/**
 * Cyan depuis l’ancre visuelle split (2,8 m) — total pied→pointe ≈ LEAD + TIP = 5,75 m.
 */
export const NAV_ARROW_TIP_AHEAD_METERS = 2.8;
/**
 * Split route en avant du GPS — aligne vert/cyan sous la base (iconOffset Y + pitch 3D).
 */
export const NAV_ROUTE_ICON_LEAD_METERS = 3.15;
/** Base triangle depuis l’ancre split — vert visible s’arrête derrière. */
export const NAV_ARROW_BASE_FORWARD_METERS =
  NAV_ARROW_TIP_AHEAD_METERS * (26 / 58);
/**
 * Décalage écran vertical de la flèche (px ref. 2340) — évite le recouvrement
 * par la barre trip React Native. N'affecte pas le GPS ni la caméra.
 */
export const NAV_ARROW_SCREEN_OFFSET_Y = -54;
/** Compense parallax pitch — centre icône = axe vert/cyan. */
export const NAV_ARROW_SCREEN_OFFSET_X = -4;
/** Canvas 128 — centre y=90, ancre bas y=128 → 38/58 de la hauteur flèche. */
export const NAV_ARROW_JUNCTION_BODY_RATIO = 38 / 58;
/** Hauteur icône ref. écran (px @ 2340) — alignée VEHICLE_ICON_HEIGHT_RATIO. */
const NAV_ARROW_ICON_HEIGHT_REF_PX = VEHICLE_ICON_HEIGHT_RATIO * 2340;
/** Centre sprite depuis la base (px ref.) — position réelle du centre géométrique. */
const NAV_ARROW_ICON_CENTER_FROM_BASE_REF_PX =
  NAV_ARROW_ICON_HEIGHT_REF_PX * NAV_ARROW_JUNCTION_BODY_RATIO;

/**
 * Distance ancre bas → centre icône sur la polyline.
 * LEAD compense iconOffset à la base ; le centre sprite est centerPx au-dessus :
 * forward = LEAD × (centerPx / iconOffsetPx).
 */
export function iconCenterAheadFromAnchorMeters(): number {
  const iconOffsetRefPx = Math.abs(NAV_ARROW_SCREEN_OFFSET_Y);
  if (iconOffsetRefPx <= 0) {
    return NAV_ARROW_TIP_AHEAD_METERS * NAV_ARROW_JUNCTION_BODY_RATIO;
  }
  return (
    NAV_ROUTE_ICON_LEAD_METERS *
    (NAV_ARROW_ICON_CENTER_FROM_BASE_REF_PX / iconOffsetRefPx)
  );
}

export const NAV_ARROW_JUNCTION_AHEAD_METERS = iconCenterAheadFromAnchorMeters();

/** Distance route (m) du split vert/cyan — centre réel icône, icône inchangée. */
export function junctionRouteMetersFromTraveled(traveledMeters: number): number {
  return (
    traveledMeters +
    NAV_ROUTE_ICON_LEAD_METERS +
    iconCenterAheadFromAnchorMeters()
  );
}
/** Base triangle y=110 → vert derrière (canvas 128). */
export const NAV_ARROW_BASE_CANVAS_RATIO = (128 - 110) / 128;
/** Vert visible s’arrête juste derrière la base. */
export const NAV_ARROW_BASE_BEHIND_METERS = 0.35;

/** @deprecated Utiliser computeThenToastBottom() */
export const NAV_THEN_TOAST_BOTTOM_RATIO = 188 / 2340;

export const NAV_MAP = {
  land: "#1A2838",
  road: "#6E8AA4",
  roadOpacity: 0.92,
  roadCase: "#4F677C",
  roadCaseOpacity: 0.68,
  label: "#F1F5F9",
} as const;

/** Flèche MMD 112×58 dans canvas 128 — iconSize 1 ≈ 112 px de large. */
export const NAV_ARROW_SPRITE_WIDTH = 103;

/** Calibrage iconSize — mesure MMD avant cal. 110 px @ 1080 (scripts/measure-mmd-precise.mjs). */
const MMD_PRECAL_ICON_WIDTH_RATIO = 110 / 1080;
export const NAV_ARROW_ICON_SCALE =
  REF_NAV_MEASURE.vehicleWidthRatio / MMD_PRECAL_ICON_WIDTH_RATIO;

const NAV_ARROW_ICON_SIZE_AT_ZOOM = {
  15: 0.82,
  16: 0.88,
  17: 0.93,
  18: 0.97,
  19: 1.0,
} as const;

export const NAV_ARROW_ICON = {
  size: [
    "interpolate",
    ["linear"],
    ["zoom"],
    15,
    NAV_ARROW_ICON_SIZE_AT_ZOOM[15] * NAV_ARROW_ICON_SCALE,
    16,
    NAV_ARROW_ICON_SIZE_AT_ZOOM[16] * NAV_ARROW_ICON_SCALE,
    17,
    NAV_ARROW_ICON_SIZE_AT_ZOOM[17] * NAV_ARROW_ICON_SCALE,
    18,
    NAV_ARROW_ICON_SIZE_AT_ZOOM[18] * NAV_ARROW_ICON_SCALE,
    19,
    NAV_ARROW_ICON_SIZE_AT_ZOOM[19] * NAV_ARROW_ICON_SCALE,
  ],
  offset: [0, 0] as const,
} as const;

export const NAV_ARROW_BEARING_OFFSET = 0;

/** @deprecated Utiliser NAV_ICON_SCREEN_RATIO */
export const WAZE_ICON_BASE_SCREEN_RATIO = NAV_ICON_SCREEN_RATIO;
