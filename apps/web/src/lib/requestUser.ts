import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseUserClient,
} from "@/lib/mmdLocationCore";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * Resolve the authenticated user from Bearer (mobile/web API) or cookies (web SSR).
 */
export async function resolveRequestUser(
  req: NextRequest,
): Promise<User | null> {
  const token = getBearerToken(req);
  if (token) {
    try {
      const client = getSupabaseUserClient(token);
      const {
        data: { user },
      } = await client.auth.getUser();
      if (user?.id) return user;
    } catch {
      // fall through to cookie session
    }
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}
