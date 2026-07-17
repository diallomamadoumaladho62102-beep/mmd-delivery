import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";
import { logTechnicalError, toUserFacingError } from "./userFacingError";

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Session expired. Please sign in again.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

async function loyaltyGet(path: string) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    logTechnicalError(`loyalty.get${path}`, out, { status: res.status });
    throw new Error(
      toUserFacingError(
        out,
        "Une action temporairement impossible s'est produite. Veuillez réessayer.",
      ),
    );
  }
  return out;
}

async function loyaltyPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    logTechnicalError(`loyalty.post${path}`, out, { status: res.status });
    throw new Error(
      toUserFacingError(
        out,
        "Une action temporairement impossible s'est produite. Veuillez réessayer.",
      ),
    );
  }
  return out;
}

export type LoyaltySummary = {
  points_balance: number;
  lifetime_points: number;
  tier_code: string;
  tier_label: string;
  credit_cents: number;
  currency: string;
  referral_code: string | null;
  settings: {
    enabled: boolean;
    conversion_points: number;
    conversion_credit_cents: number;
    credit_validity_months: number;
  };
};

export type LoyaltyPointsEntry = {
  id: string;
  delta_points: number;
  balance_after: number;
  entry_type: string;
  reference_type: string | null;
  description: string | null;
  created_at: string;
};

export type LoyaltyCreditEntry = {
  id: string;
  delta_cents: number;
  balance_after_cents: number;
  entry_type: string;
  description: string | null;
  currency: string;
  created_at: string;
};

export async function fetchLoyaltySummary(): Promise<LoyaltySummary> {
  const out = await loyaltyGet("/api/loyalty/summary");
  return out.summary as LoyaltySummary;
}

export async function fetchLoyaltyHistory(): Promise<{
  points: LoyaltyPointsEntry[];
  credit: LoyaltyCreditEntry[];
}> {
  const out = await loyaltyGet("/api/loyalty/history?limit=50");
  return {
    points: (out.points ?? []) as LoyaltyPointsEntry[],
    credit: (out.credit ?? []) as LoyaltyCreditEntry[],
  };
}

export async function convertLoyaltyPoints(
  blocks: number,
): Promise<{ result: Record<string, unknown>; summary: LoyaltySummary }> {
  const out = await loyaltyPost("/api/loyalty/convert", { blocks });
  return {
    result: (out.result ?? {}) as Record<string, unknown>,
    summary: out.summary as LoyaltySummary,
  };
}

export type LoyaltyReferral = {
  id: string;
  audience: string;
  status: string;
  created_at: string;
};

export async function fetchLoyaltyReferral(): Promise<{
  code: string | null;
  link: string | null;
  referrals: LoyaltyReferral[];
  counts: { total: number; rewarded: number; pending: number };
}> {
  const out = await loyaltyGet("/api/loyalty/referral");
  return {
    code: (out.code ?? null) as string | null,
    link: (out.link ?? null) as string | null,
    referrals: (out.referrals ?? []) as LoyaltyReferral[],
    counts: out.counts ?? { total: 0, rewarded: 0, pending: 0 },
  };
}

export async function applyReferralCode(
  code: string,
): Promise<Record<string, unknown>> {
  return loyaltyPost("/api/loyalty/referral", { code });
}
