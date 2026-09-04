import { API_BASE_URL } from "./apiBase";
import { CLIENT_SCREEN_FETCH_TIMEOUT_MS, withTimeout } from "./bootFailOpen";
import { supabase } from "./supabase";

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export type DeletableAccountRole = "client" | "driver" | "restaurant" | "seller";

export async function resolveDeletableAccountRole(): Promise<
  DeletableAccountRole | null
> {
  const { data: sessionData } = await withTimeout(
    supabase.auth.getSession(),
    CLIENT_SCREEN_FETCH_TIMEOUT_MS,
    "delete_account_resolve_session",
  );
  const uid = sessionData.session?.user?.id;
  if (!uid) return null;

  const { data } = await withTimeout(
    (async () =>
      supabase.from("profiles").select("role").eq("id", uid).maybeSingle())(),
    CLIENT_SCREEN_FETCH_TIMEOUT_MS,
    "delete_account_resolve_role",
  );

  const role = String(
    (data as { role?: string } | null)?.role ?? "client",
  )
    .trim()
    .toLowerCase();

  if (
    role === "client" ||
    role === "driver" ||
    role === "restaurant" ||
    role === "seller"
  ) {
    return role;
  }
  if (role === "merchant" || role === "merchant_owner") return "seller";
  return null;
}

export async function openDeleteAccountScreen(navigation: {
  navigate: (name: "DeleteAccount", params: { role: DeletableAccountRole }) => void;
}): Promise<"ok" | "blocked"> {
  const role = (await resolveDeletableAccountRole()) ?? "client";
  navigation.navigate("DeleteAccount", { role });
  return "ok";
}

export async function deleteMyAccount(params: {
  password: string;
  expectedRole: DeletableAccountRole;
}): Promise<DeleteAccountResult> {
  let sessionData: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"];
  try {
    const sessionRes = await withTimeout(
      supabase.auth.getSession(),
      CLIENT_SCREEN_FETCH_TIMEOUT_MS,
      "delete_account_session",
    );
    if (sessionRes.error) {
      return { ok: false, error: sessionRes.error.message };
    }
    sessionData = sessionRes.data;
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? err.message
          : "Session check timed out. Please try again.",
    };
  }
  const token = sessionData.session?.access_token;
  if (!token) {
    return { ok: false, error: "Session expired. Please sign in again." };
  }

  const base = String(API_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(`${base}/api/account/delete`, {
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
      signal: controller.signal,
    });
  } catch (err) {
    const aborted =
      (err instanceof Error && err.name === "AbortError") ||
      String(err).toLowerCase().includes("abort");
    return {
      ok: false,
      error: aborted
        ? "Request timed out. Check your connection and try again."
        : err instanceof Error
          ? err.message
          : "Network error",
    };
  } finally {
    clearTimeout(timer);
  }

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

  try {
    await withTimeout(
      supabase.auth.signOut(),
      CLIENT_SCREEN_FETCH_TIMEOUT_MS,
      "delete_account_sign_out",
    );
  } catch {
    // Deletion already succeeded server-side; proceed even if local sign-out hangs.
  }
  return { ok: true };
}
