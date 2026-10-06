import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "./supabase";

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function postDriverReview(
  path: "/api/driver/pending-notice" | "/api/driver/resubmit",
): Promise<{ ok: boolean; error?: string }> {
  const token = await accessToken();
  if (!token) return { ok: false, error: "not_authenticated" };
  try {
    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || json.ok === false) {
      return { ok: false, error: String(json.error ?? "request_failed") };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "request_failed" };
  }
}

/** Idempotent. Safe to call on every pending visit. */
export async function notifyDriverApplicationPending(): Promise<void> {
  await postDriverReview("/api/driver/pending-notice");
}

/** Same auth user and same driver_profiles row. rejected → pending. */
export async function resubmitDriverApplication(): Promise<{ ok: boolean; error?: string }> {
  return postDriverReview("/api/driver/resubmit");
}
