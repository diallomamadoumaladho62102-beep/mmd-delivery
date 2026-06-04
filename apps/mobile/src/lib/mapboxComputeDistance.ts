import { supabase } from "./supabase";

export type MapboxComputeDistanceBody = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
};

export async function getMapboxAuthHeaders(): Promise<Record<string, string>> {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message || "Session error");
  }

  const token = data.session?.access_token?.trim() ?? "";

  if (!token) {
    throw new Error("Session required for delivery estimate");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function fetchMapboxComputeDistance(params: {
  apiBaseUrl: string;
  body: MapboxComputeDistanceBody;
  signal?: AbortSignal;
}): Promise<Response> {
  const base = params.apiBaseUrl.replace(/\/+$/, "");
  const url = `${base}/api/mapbox/compute-distance`;
  const headers = await getMapboxAuthHeaders();

  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params.body),
    signal: params.signal,
  });
}
