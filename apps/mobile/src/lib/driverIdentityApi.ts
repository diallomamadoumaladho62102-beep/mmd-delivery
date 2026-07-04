import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";

export type DriverIdentityGateStatus =
  | "not_required"
  | "required"
  | "pending"
  | "submitted"
  | "verified"
  | "rejected"
  | "manual_review"
  | "expired"
  | "canceled";

export type DriverIdentityActiveCheck = {
  id: string;
  status: string;
  trigger_type: string;
  reason: string | null;
  requires_manual_review: boolean;
  expires_at: string | null;
  created_at: string;
  submitted_at: string | null;
};

export type DriverIdentityStatusResult = {
  gate_status: DriverIdentityGateStatus;
  can_go_online: boolean;
  message: string | null;
  reason: string | null;
  active_check: DriverIdentityActiveCheck | null;
};

async function authFetch(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    const err = new Error(String(body.error ?? body.message ?? `Request failed (${res.status})`));
    (err as Error & { code?: string }).code = String(body.error ?? "");
    throw err;
  }
  return body;
}

export async function fetchDriverIdentityStatus(params: {
  intent?: "go_online" | "refresh";
  deviceId?: string | null;
  city?: string | null;
  country?: string | null;
}): Promise<DriverIdentityStatusResult> {
  const qs = new URLSearchParams();
  qs.set("intent", params.intent ?? "refresh");
  if (params.deviceId) qs.set("device_id", params.deviceId);
  if (params.city) qs.set("city", params.city);
  if (params.country) qs.set("country", params.country);

  const body = await authFetch(`/api/driver/identity/status?${qs.toString()}`);
  return {
    gate_status: body.gate_status,
    can_go_online: Boolean(body.can_go_online),
    message: body.message ?? null,
    reason: body.reason ?? null,
    active_check: body.active_check ?? null,
  };
}

export async function prepareIdentitySelfieUpload(checkId: string, ext = "jpg") {
  return authFetch(`/api/driver/identity/checks/${encodeURIComponent(checkId)}`, {
    method: "POST",
    body: JSON.stringify({ action: "prepare_upload", ext }),
  }) as Promise<{ path: string; bucket: string; check_id: string }>;
}

export async function registerIdentitySelfieUpload(checkId: string, path: string) {
  return authFetch(`/api/driver/identity/checks/${encodeURIComponent(checkId)}`, {
    method: "POST",
    body: JSON.stringify({ action: "register_upload", path }),
  });
}

export async function submitDriverIdentityCheck(checkId: string) {
  return authFetch(`/api/driver/identity/checks/${encodeURIComponent(checkId)}`, {
    method: "POST",
    body: JSON.stringify({ action: "submit" }),
  }) as Promise<{ gate_status: DriverIdentityGateStatus; check: { status: string } }>;
}

export function identityBlocksDriverOnline(status: DriverIdentityGateStatus): boolean {
  return [
    "required",
    "pending",
    "submitted",
    "manual_review",
    "rejected",
    "expired",
  ].includes(status);
}
