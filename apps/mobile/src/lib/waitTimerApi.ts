import { getApiBaseUrl } from "../../lib/apiBase";
import { formatTimer, formatWaitFee } from "./waitTimerFormat";

export { formatTimer, formatWaitFee };

export type WaitTimerEntityType = "order" | "delivery_request" | "taxi_ride";

export type WaitTimerState = {
  ok: boolean;
  entity_type?: WaitTimerEntityType;
  entity_id?: string;
  driver_arrived_at?: string | null;
  wait_timer_started_at?: string | null;
  leave_at_door?: boolean;
  timer?: {
    elapsed_seconds: number;
    elapsed_minutes: number;
    free_wait_minutes: number;
    billable_minutes: number;
    wait_fee_cents: number;
    wait_fee_dollars: number;
    wait_fee_status: string;
    max_fee_reached: boolean;
    can_deposit_at_door: boolean;
    can_cancel_no_penalty: boolean;
    remaining_free_seconds: number;
  };
  history?: Array<{
    id: string;
    event_type: string;
    description: string | null;
    created_at: string;
  }>;
  currency?: string;
  error?: string;
};

async function authFetch<T>(
  path: string,
  accessToken: string,
  init?: RequestInit
): Promise<T> {
  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers ?? {}),
    },
  });
  const raw = await res.text();
  let json: T;
  try {
    json = raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    throw new Error(raw || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    const message =
      (json as { message?: string; error?: string }).message ??
      (json as { error?: string }).error ??
      raw;
    throw new Error(message || `HTTP ${res.status}`);
  }
  return json;
}

export async function driverArrivedWaitTimer(
  accessToken: string,
  body: {
    entity_type: WaitTimerEntityType;
    entity_id: string;
    driver_lat: number;
    driver_lng: number;
    force_manual?: boolean;
  }
): Promise<WaitTimerState> {
  return authFetch<WaitTimerState>("/api/wait-timer/arrive", accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function fetchWaitTimerStatus(
  accessToken: string,
  params: { entityType: WaitTimerEntityType; entityId: string }
): Promise<WaitTimerState> {
  const query = new URLSearchParams({
    entity_type: params.entityType,
    entity_id: params.entityId,
  });
  return authFetch<WaitTimerState>(`/api/wait-timer/status?${query.toString()}`, accessToken);
}

export async function depositAtDoorWithProof(
  accessToken: string,
  body: {
    entity_type: "order" | "delivery_request";
    entity_id: string;
    proof_photo_url: string;
  }
) {
  return authFetch<{ ok: boolean; error?: string }>("/api/wait-timer/deposit-at-door", accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function cancelTaxiNoShow(accessToken: string, rideId: string) {
  return authFetch<{ ok: boolean; error?: string }>(
    "/api/wait-timer/taxi-no-show-cancel",
    accessToken,
    {
      method: "POST",
      body: JSON.stringify({ taxi_ride_id: rideId }),
    }
  );
}
