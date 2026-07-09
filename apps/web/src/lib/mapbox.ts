import { getPublicMapboxToken } from "@/lib/mapboxToken";

/** Client-safe Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN, with legacy alias). */
export const MAPBOX_TOKEN = getPublicMapboxToken() ?? undefined;
