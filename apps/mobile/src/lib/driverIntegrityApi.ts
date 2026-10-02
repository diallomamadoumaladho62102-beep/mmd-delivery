import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";

export type DriverIntegrityEntityType = "order" | "delivery_request" | "marketplace_job";

export type WaitReasonCatalog = {
  ok: boolean;
  reasons: string[];
  current?: { id?: string; reason_code?: string; created_at?: string } | null;
  already_submitted?: boolean;
  timestamps_unchanged?: boolean;
  error?: string;
};

export type DisputeCatalog = {
  ok: boolean;
  reasons: string[];
  current?: { id?: string; reason_code?: string; created_at?: string } | null;
  already_submitted?: boolean;
  timestamps_unchanged?: boolean;
  earnings_unchanged?: boolean;
  incident_closed?: boolean;
  error?: string;
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
  if (res.status === 403) {
    return { ...body, ok: false, error: body.error ?? "forbidden" };
  }
  if (!res.ok && body.ok !== true) {
    throw Object.assign(new Error(String(body.error ?? body.message ?? `Request failed (${res.status})`)), {
      code: body.error,
      status: res.status,
      body,
    });
  }
  return body;
}

export async function fetchWaitReasonCatalog(params: {
  entityType: DriverIntegrityEntityType;
  entityId: string;
}): Promise<WaitReasonCatalog> {
  const qs = new URLSearchParams({
    entity_type: params.entityType,
    entity_id: params.entityId,
  });
  return authFetch(`/api/driver/integrity/wait-reason?${qs.toString()}`);
}

export async function submitWaitReason(params: {
  entityType: DriverIntegrityEntityType;
  entityId: string;
  reasonCode: string;
  explanation?: string;
}): Promise<WaitReasonCatalog> {
  return authFetch("/api/driver/integrity/wait-reason", {
    method: "POST",
    body: JSON.stringify({
      entity_type: params.entityType,
      entity_id: params.entityId,
      reason_code: params.reasonCode,
      explanation: params.explanation ?? null,
    }),
  });
}

export async function fetchDisputeCatalog(params: {
  entityType: DriverIntegrityEntityType;
  entityId: string;
}): Promise<DisputeCatalog> {
  const qs = new URLSearchParams({
    entity_type: params.entityType,
    entity_id: params.entityId,
  });
  return authFetch(`/api/driver/integrity/dispute?${qs.toString()}`);
}

export async function submitDispute(params: {
  entityType: DriverIntegrityEntityType;
  entityId: string;
  reasonCode: string;
  explanation?: string;
}): Promise<DisputeCatalog> {
  return authFetch("/api/driver/integrity/dispute", {
    method: "POST",
    body: JSON.stringify({
      entity_type: params.entityType,
      entity_id: params.entityId,
      reason_code: params.reasonCode,
      explanation: params.explanation ?? null,
    }),
  });
}

export function resolveIntegrityEntityType(input: {
  sourceTable?: string | null;
  kind?: string | null;
}): DriverIntegrityEntityType {
  const source = String(input.sourceTable ?? "").toLowerCase();
  const kind = String(input.kind ?? "").toLowerCase();
  if (source === "marketplace_delivery_jobs" || kind === "marketplace") {
    return "marketplace_job";
  }
  if (source === "delivery_requests" || kind === "delivery" || kind === "delivery_request") {
    return "delivery_request";
  }
  return "order";
}
