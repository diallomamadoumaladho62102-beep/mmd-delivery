/**
 * Remote road-safety source: calls the `road-safety-events` Supabase Edge
 * Function (no provider secret keys in the app) and normalizes the response
 * into `RoadSafetyEvent`s + a runtime config. The response parser is pure and
 * unit-tested; the network call is a thin wrapper around supabase-js.
 */
import type { RoadSafetyDirection, RoadSafetyEvent, RoadSafetyEventType } from "./roadSafety";
import { resolveRuntimeConfig, type RoadSafetyRuntimeConfig } from "./roadSafetyConfig";
import type { Bbox } from "./roadSafetyCache";

const VALID_TYPES: RoadSafetyEventType[] = [
  "speed_camera",
  "red_light_camera",
  "speed_limit",
  "stop_sign",
  "school_zone",
];

const VALID_DIRECTIONS: RoadSafetyDirection[] = ["forward", "backward", "both", "unknown"];

export type RoadSafetyResponse = {
  events: RoadSafetyEvent[];
  config: RoadSafetyRuntimeConfig;
  attribution: string;
};

function toEvent(raw: any): RoadSafetyEvent | null {
  if (!raw || !VALID_TYPES.includes(raw.type)) return null;
  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const direction: RoadSafetyDirection = VALID_DIRECTIONS.includes(raw.direction)
    ? raw.direction
    : "unknown";

  return {
    id: String(raw.id ?? `${raw.source ?? "src"}:${raw.source_ref ?? `${latitude},${longitude}`}`),
    type: raw.type,
    coordinate: { latitude, longitude },
    source: String(raw.source ?? "unknown"),
    confidence: Number.isFinite(Number(raw.confidence)) ? Number(raw.confidence) : 0.5,
    direction,
    bearing: Number.isFinite(Number(raw.bearing)) ? Number(raw.bearing) : undefined,
    speedLimitKmh:
      raw.speed_limit_kmh != null && Number.isFinite(Number(raw.speed_limit_kmh))
        ? Number(raw.speed_limit_kmh)
        : null,
    schedule:
      raw.schedule && typeof raw.schedule.activeNow === "boolean"
        ? { activeNow: raw.schedule.activeNow }
        : null,
  };
}

/** Pure: normalize the raw Edge Function payload into a typed response. */
export function parseRoadSafetyResponse(raw: any): RoadSafetyResponse {
  const events = Array.isArray(raw?.events)
    ? raw.events.map(toEvent).filter((e: RoadSafetyEvent | null): e is RoadSafetyEvent => e != null)
    : [];
  return {
    events,
    config: resolveRuntimeConfig(raw?.config ?? null),
    attribution: String(raw?.attribution ?? "© OpenStreetMap contributors"),
  };
}

type SupabaseLike = {
  functions: {
    invoke: (
      name: string,
      opts: { body: unknown },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
};

/** Fetch + parse road-safety events for a route bbox/country. */
export async function fetchRoadSafetyEvents(
  supabase: SupabaseLike,
  params: { bbox: Bbox; countryCode: string | null },
): Promise<RoadSafetyResponse> {
  const { data, error } = await supabase.functions.invoke("road-safety-events", {
    body: { bbox: params.bbox, countryCode: params.countryCode },
  });
  if (error) throw error instanceof Error ? error : new Error("road_safety_fetch_failed");
  return parseRoadSafetyResponse(data);
}
