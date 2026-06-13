import { canAccessAdminDashboard } from "@/lib/adminAccess";
import { normalizeUserRole, type UserRole } from "@/lib/roles";
import { supabase } from "@/lib/supabaseBrowser";

export type ResolvedStaffSession = {
  userId: string;
  role: UserRole;
};

async function readAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.warn("[adminBrowserAuth] getSession failed", error.message);
      return null;
    }
    return data.session?.access_token ?? null;
  } catch (err) {
    console.warn("[adminBrowserAuth] getSession exception", err);
    return null;
  }
}

export async function waitForBrowserSession(timeoutMs = 5000): Promise<string | null> {
  let token = await readAccessToken();
  if (token) return token;

  try {
    const refreshed = await supabase.auth.refreshSession();
    if (!refreshed.error) {
      token = refreshed.data.session?.access_token ?? null;
      if (token) return token;
    }
  } catch (err) {
    console.warn("[adminBrowserAuth] refreshSession failed", err);
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      subscription.unsubscribe();
      resolve(value);
    };

    const timer = window.setTimeout(() => {
      void readAccessToken()
        .then(finish)
        .catch(() => finish(null));
    }, timeoutMs);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        finish(session.access_token);
      }
    });
  });
}

export async function getAdminAccessToken(): Promise<string> {
  const token = await waitForBrowserSession();
  if (!token) {
    throw new Error("Session admin expirée. Reconnecte-toi.");
  }
  return token;
}

export async function adminFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  const token = await getAdminAccessToken();
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);

  return fetch(input, {
    ...init,
    headers,
    cache: init?.cache ?? "no-store",
  });
}

export async function resolveBrowserStaffSession(): Promise<ResolvedStaffSession | null> {
  try {
    const token = await waitForBrowserSession();
    if (!token) return null;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);

    let res: Response;
    try {
      res = await fetch("/api/admin/me", {
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } finally {
      window.clearTimeout(timeout);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) return null;

    const role = normalizeUserRole(body.role);
    if (!role || !canAccessAdminDashboard(role)) return null;

    return {
      userId: String(body.userId),
      role,
    };
  } catch (err) {
    console.warn("[adminBrowserAuth] resolveBrowserStaffSession failed", err);
    return null;
  }
}
