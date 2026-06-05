import { supabase } from "@/lib/supabaseBrowser";

export async function getAdminAccessToken(): Promise<string> {
  let { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(error.message);
  }

  if (!data.session?.access_token) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) {
      throw new Error(refreshed.error.message);
    }
    data = refreshed.data;
  }

  const token = data.session?.access_token;
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
