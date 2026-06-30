/**
 * Mapbox Streets (streets-v12) — fond identique à RestaurantLiveMap.
 *
 * Ne masquer aucune couche native du style Streets : certaines ids « navigation »
 * existent aussi dans streets-v12 (road-path, turning-feature, oneway arrows)
 * et délavent routes / intersections si visibility=none.
 *
 * La route MMD vert/cyan est rendue via DriverNavigationRouteLayers (couches RNMapbox).
 * Les panneaux vitesse natifs Mapbox n'existent pas dans streets-v12.
 */

/** Couches streets-v12 qu'il ne faut jamais masquer via reduceNavigationMapClutter. */
export const STREETS_V12_PROTECTED_LAYER_IDS = [
  "road-path",
  "road-oneway-arrow-blue",
  "road-oneway-arrow-white",
  "turning-feature",
  "turning-feature-outline",
] as const;
