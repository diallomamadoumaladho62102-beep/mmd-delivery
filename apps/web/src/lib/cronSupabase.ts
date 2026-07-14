import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CRON_SUPABASE_TIMEOUT_MS,
  createTimedFetch,
} from "@/lib/cronTimeouts";

export function buildCronSupabaseAdmin(
  timeoutMs = CRON_SUPABASE_TIMEOUT_MS
): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing Supabase admin env");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: createTimedFetch(timeoutMs),
    },
  });
}
