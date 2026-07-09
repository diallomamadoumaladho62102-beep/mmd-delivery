/** Approximate US county bounding boxes for GPS scope (NY launch counties). */

export type UsCountyBBox = {
  stateCode: string;
  countyCode: string;
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/**
 * Ordered most-specific first where boxes overlap (NYC before Nassau/Westchester edges).
 * Approximate boxes — admin toggles still come from DB; this only resolves which county row to load.
 */
const US_COUNTY_BBOXES: UsCountyBBox[] = [
  // New York City (5 boroughs approximate envelope)
  { stateCode: "NY", countyCode: "nyc", minLat: 40.4774, maxLat: 40.9176, minLng: -74.2591, maxLng: -73.7004 },
  // Nassau County (Long Island west)
  { stateCode: "NY", countyCode: "nassau", minLat: 40.58, maxLat: 40.92, minLng: -73.77, maxLng: -73.42 },
  // Suffolk County (Long Island east)
  { stateCode: "NY", countyCode: "suffolk", minLat: 40.72, maxLat: 41.2, minLng: -73.5, maxLng: -71.85 },
  // Westchester County
  { stateCode: "NY", countyCode: "westchester", minLat: 40.88, maxLat: 41.37, minLng: -73.98, maxLng: -73.48 },
];

const NY_COUNTY_NAME_TO_CODE: Record<string, string> = {
  NASSAU: "nassau",
  "NASSAU COUNTY": "nassau",
  SUFFOLK: "suffolk",
  "SUFFOLK COUNTY": "suffolk",
  NYC: "nyc",
  "NEW YORK CITY": "nyc",
  "NEW YORK": "nyc",
  "NYC / TLC": "nyc",
  WESTCHESTER: "westchester",
  "WESTCHESTER COUNTY": "westchester",
};

const KNOWN_COUNTY_CODES = new Set(Object.values(NY_COUNTY_NAME_TO_CODE));

export function normalizeUsCountyCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const upperName = raw.toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (NY_COUNTY_NAME_TO_CODE[upperName]) {
    return NY_COUNTY_NAME_TO_CODE[upperName];
  }

  const code = raw.toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
  if (KNOWN_COUNTY_CODES.has(code)) return code;

  // Allow future DB-driven codes that are already snake_case (no spaces in original).
  if (/^[a-z][a-z0-9_]*$/.test(code) && !/\s/.test(raw) && code.length <= 64) {
    return code;
  }

  return null;
}

export function detectUsCountyFromCoordinates(
  lat?: unknown,
  lng?: unknown,
  stateCode?: string | null
): string | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const state = String(stateCode ?? "").trim().toUpperCase() || null;

  for (const box of US_COUNTY_BBOXES) {
    if (state && box.stateCode !== state) continue;
    if (
      latitude >= box.minLat &&
      latitude <= box.maxLat &&
      longitude >= box.minLng &&
      longitude <= box.maxLng
    ) {
      return box.countyCode;
    }
  }

  return null;
}
