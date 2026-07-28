import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "./supabase";

export type IdentitySubjectType =
  | "driver"
  | "restaurant"
  | "seller"
  | "business"
  | "client"
  | "admin";

export type IdentityStatusResponse = {
  ok: boolean;
  required?: boolean;
  enabled?: boolean;
  verified?: boolean;
  canProceed?: boolean;
  status?: string;
  provider?: string;
  attempts?: number;
  maxAttempts?: number;
  failedReason?: string | null;
  activeSessionId?: string | null;
  error?: string;
  message?: string;
};

export type IdentitySessionResponse = {
  ok: boolean;
  sessionId?: string;
  url?: string | null;
  clientSecret?: string | null;
  ephemeralKeySecret?: string | null;
  status?: string;
  provider?: string;
  error?: string;
  message?: string;
};

async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function fetchIdentityStatus(
  subjectType: IdentitySubjectType,
  featureKey = "default"
): Promise<IdentityStatusResponse> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not_authenticated" };

  const qs = new URLSearchParams({
    subject_type: subjectType,
    feature_key: featureKey,
  });
  const res = await fetch(`${getApiBaseUrl()}/api/identity/status?${qs}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  return (await res.json().catch(() => ({ ok: false, error: "invalid_json" }))) as IdentityStatusResponse;
}

export async function createIdentitySession(params: {
  subjectType: IdentitySubjectType;
  featureKey?: string;
  returnUrl?: string | null;
}): Promise<IdentitySessionResponse> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "not_authenticated" };

  const res = await fetch(`${getApiBaseUrl()}/api/identity/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subject_type: params.subjectType,
      feature_key: params.featureKey ?? "default",
      return_url: params.returnUrl ?? null,
    }),
  });

  return (await res.json().catch(() => ({ ok: false, error: "invalid_json" }))) as IdentitySessionResponse;
}
