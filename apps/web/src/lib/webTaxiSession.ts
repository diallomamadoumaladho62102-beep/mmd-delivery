"use client";

import { supabase } from "@/lib/supabaseBrowser";

export async function webTaxiFetch(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) {
    return { ok: false as const, status: 401, body: { error: "sign_in_required" } };
  }
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  try {
    const response = await fetch(path, { ...init, headers });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok && body.ok !== false, status: response.status, body };
  } catch {
    return { ok: false as const, status: 0, body: { error: "network_error" } };
  }
}
