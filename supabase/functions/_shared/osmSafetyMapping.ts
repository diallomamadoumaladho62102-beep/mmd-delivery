/**
 * Pure mapping from OpenStreetMap (Overpass) elements to normalized road-safety
 * events. No Deno/runtime APIs here so it is unit-testable from the mobile tsx
 * harness as well as importable by the ingestion Edge Function.
 *
 * OSM tagging references used (only real, documented tags — nothing invented):
 * - Speed camera:        highway=speed_camera
 * - Red-light/enforcement: highway=speed_camera + speed_camera=* / enforcement=maxspeed|traffic_signals
 *                         or type=enforcement relation with enforcement=traffic_signals
 * - Stop sign:           highway=stop
 * - School zone:         amenity=school (area) or hazard=school_zone / maxspeed:conditional=* @ (school)
 * - Speed limit value:   maxspeed=* (km/h, or "N mph")
 *
 * OSM data is ODbL — attribution "© OpenStreetMap contributors" is mandatory.
 */

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type NormalizedSafetyEvent = {
  type:
    | "speed_camera"
    | "red_light_camera"
    | "speed_limit"
    | "stop_sign"
    | "school_zone";
  latitude: number;
  longitude: number;
  source: "osm";
  source_ref: string;
  confidence: number;
  direction: "forward" | "backward" | "both" | "unknown";
  bearing: number | null;
  speed_limit_kmh: number | null;
  schedule: { activeNow: boolean } | null;
  provider_meta: Record<string, unknown>;
};

/** Parse an OSM `maxspeed` value into km/h (supports "50", "30 mph", "walk"). */
export function parseMaxSpeedKmh(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === "none" || value === "signals" || value === "walk") return null;
  const mph = value.match(/^(\d+(?:\.\d+)?)\s*mph$/);
  if (mph) return Math.round(parseFloat(mph[1]) * 1.609344);
  const kmh = value.match(/^(\d+(?:\.\d+)?)(\s*km\/h)?$/);
  if (kmh) return Math.round(parseFloat(kmh[1]));
  return null;
}

function coordOf(el: OsmElement): { lat: number; lon: number } | null {
  if (typeof el.lat === "number" && typeof el.lon === "number") {
    return { lat: el.lat, lon: el.lon };
  }
  if (el.center) return { lat: el.center.lat, lon: el.center.lon };
  return null;
}

function directionFrom(tags: Record<string, string>): NormalizedSafetyEvent["direction"] {
  const dir = (tags["direction"] ?? tags["camera:direction"] ?? "").toLowerCase();
  if (/forward/.test(dir)) return "forward";
  if (/backward/.test(dir)) return "backward";
  if (tags["oneway"] === "yes") return "forward";
  return "unknown";
}

function bearingFrom(tags: Record<string, string>): number | null {
  const raw = tags["direction"] ?? tags["camera:direction"] ?? "";
  const num = parseFloat(raw);
  if (Number.isFinite(num) && num >= 0 && num < 360) return num;
  return null;
}

/**
 * Map a single OSM element to a normalized event, or null when it is not a
 * recognized/reliable safety feature. Never fabricates values.
 */
export function mapOsmElement(el: OsmElement): NormalizedSafetyEvent | null {
  const tags = el.tags ?? {};
  const coord = coordOf(el);
  if (!coord) return null;

  const base = {
    latitude: coord.lat,
    longitude: coord.lon,
    source: "osm" as const,
    source_ref: `${el.type}/${el.id}`,
    direction: directionFrom(tags),
    bearing: bearingFrom(tags),
    schedule: null,
    provider_meta: { osm_tags: tags },
  };

  // Speed / red-light cameras.
  if (tags["highway"] === "speed_camera" || tags["man_made"] === "surveillance") {
    const enforcement = (tags["enforcement"] ?? tags["speed_camera"] ?? "").toLowerCase();
    const isRedLight =
      /traffic_signals|red_light/.test(enforcement) ||
      tags["crossing"] === "traffic_signals";
    return {
      ...base,
      type: isRedLight ? "red_light_camera" : "speed_camera",
      confidence: 0.7,
      speed_limit_kmh: parseMaxSpeedKmh(tags["maxspeed"]),
    };
  }

  // Stop sign (only genuine stop nodes).
  if (tags["highway"] === "stop") {
    return {
      ...base,
      type: "stop_sign",
      confidence: 0.6,
      speed_limit_kmh: null,
      // A stop applies to the approaching direction; default forward when set.
      direction: tags["direction"] ? base.direction : "unknown",
    };
  }

  // School zone (school area or explicit school-zone hazard).
  if (
    tags["amenity"] === "school" ||
    tags["hazard"] === "school_zone" ||
    /school/.test(tags["maxspeed:conditional"] ?? "")
  ) {
    const conditional = tags["maxspeed:conditional"] ?? "";
    const conditionalSpeed = conditional.match(/^(\d+(?:\.\d+)?(?:\s*mph)?)/);
    return {
      ...base,
      type: "school_zone",
      confidence: 0.55,
      speed_limit_kmh: conditionalSpeed ? parseMaxSpeedKmh(conditionalSpeed[1]) : null,
      // Hours only when explicitly parseable — otherwise unknown (never assert active).
      schedule: null,
    };
  }

  return null;
}

/** Map a batch, dropping unrecognized elements and de-duplicating by source_ref. */
export function mapOsmElements(elements: OsmElement[]): NormalizedSafetyEvent[] {
  const byRef = new Map<string, NormalizedSafetyEvent>();
  for (const el of elements) {
    const mapped = mapOsmElement(el);
    if (mapped) byRef.set(mapped.source_ref, mapped);
  }
  return [...byRef.values()];
}

/** Build the Overpass QL query for a bounding box (south,west,north,east). */
export function buildOverpassQuery(bbox: {
  south: number;
  west: number;
  north: number;
  east: number;
}): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return (
    `[out:json][timeout:25];` +
    `(` +
    `node["highway"="speed_camera"](${b});` +
    `node["man_made"="surveillance"]["camera:type"](${b});` +
    `node["highway"="stop"](${b});` +
    `node["amenity"="school"](${b});` +
    `way["amenity"="school"](${b});` +
    `node["hazard"="school_zone"](${b});` +
    `);` +
    `out center tags;`
  );
}
