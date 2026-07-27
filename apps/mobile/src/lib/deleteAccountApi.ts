import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export async function deleteMyAccount(params: {
  password: string;
  expectedRole: "client" | "driver" | "restaurant";
}): Promise<DeleteAccountResult> {
  const { data: sessionData, error: sessionErr } =
    await supabase.auth.getSession();
  if (sessionErr) {
    return { ok: false, error: sessionErr.message };
  }
  const token = sessionData.session?.access_token;
  if (!token) {
    return { ok: false, error: "Session expired. Please sign in again." };
  }

  const base = String(API_BASE_URL).replace(/\/$/, "");
  const res = await fetch(`${base}/api/account/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      password: params.password,
      confirm_phrase: "DELETE",
      expected_role: params.expectedRole,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };

  if (!res.ok || body.ok === false) {
    return {
      ok: false,
      error: String(body.error ?? `Deletion failed (${res.status})`),
      status: res.status,
    };
  }

  await supabase.auth.signOut().catch(() => undefined);
  return { ok: true };
}
