import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";

export type DemandHotspot = {
  id: string;
  lat: number;
  lng: number;
  request_count: number;
  score: number;
  multiplier: number;
  demand_level: string;
  label: string;
};

export type DriverAreaIntelligence = {
  ok: true;
  area: { lat: number; lng: number; radius_miles: number };
  drivers_nearby: number;
  requests_nearby: number;
  demand_level: string;
  demand_label: string;
  earnings_multiplier: number;
  wait_minutes_min: number | null;
  wait_minutes_max: number | null;
  wait_label: string;
  nearest_request_miles: number | null;
  hotspots: DemandHotspot[];
  best_hotspot: DemandHotspot | null;
  smart_dispatch: {
    status: "live" | "offline" | "quiet";
    recommendation: string;
    chips: string[];
  };
};

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

export type DriverMarketingNextReward = {
  title: string;
  rewardLabel: string;
  progressLabel: string;
  objectiveId: string;
};

/** Next incomplete driver marketing objective (real rewards catalog). */
export async function fetchDriverNextReward(): Promise<DriverMarketingNextReward | null> {
  const res = await fetch(`${getApiBaseUrl()}/api/driver/marketing/summary`, {
    headers: await authHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) return null;

  const objectives = Array.isArray(body.objectives) ? body.objectives : [];
  const progressRows = Array.isArray(body.progress) ? body.progress : [];
  const progressByObjective = new Map<string, Record<string, unknown>>();
  for (const row of progressRows) {
    const oid = String(row.objective_id ?? row.marketing_driver_objective_id ?? "");
    if (oid) progressByObjective.set(oid, row as Record<string, unknown>);
  }

  for (const obj of objectives) {
    const id = String(obj.id ?? "");
    if (!id) continue;
    const prog = progressByObjective.get(id);
    const current = Number(prog?.current_count ?? prog?.progress_count ?? 0);
    const target = Number(obj.target_count ?? 0);
    const status = String(prog?.status ?? "").toLowerCase();
    if (status === "paid" || status === "completed") continue;
    if (target > 0 && current >= target) continue;

    const rewardCents = Number(obj.reward_cents ?? 0);
    const rewardPoints = Number(obj.reward_points ?? 0);
    let rewardLabel = "";
    if (rewardCents > 0) rewardLabel = `$${(rewardCents / 100).toFixed(2)} bonus`;
    else if (rewardPoints > 0) rewardLabel = `${rewardPoints} pts bonus`;
    else continue;

    return {
      title: String(obj.title ?? "Driver reward"),
      rewardLabel,
      progressLabel:
        target > 0 ? `${Math.min(current, target)} / ${target}` : rewardLabel,
      objectiveId: id,
    };
  }
  return null;
}

export async function fetchDriverAreaIntelligence(params: {
  lat: number;
  lng: number;
  radiusMiles?: number;
  isOnline?: boolean;
}): Promise<DriverAreaIntelligence> {
  const qs = new URLSearchParams({
    lat: String(params.lat),
    lng: String(params.lng),
    radius_miles: String(params.radiusMiles ?? 5),
  });
  if (params.isOnline != null) {
    qs.set("is_online", params.isOnline ? "true" : "false");
  }

  const res = await fetch(
    `${getApiBaseUrl()}/api/driver/area-intelligence?${qs.toString()}`,
    { headers: await authHeaders() },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message ?? body.error ?? "Area intelligence failed"));
  }
  return body as DriverAreaIntelligence;
}
