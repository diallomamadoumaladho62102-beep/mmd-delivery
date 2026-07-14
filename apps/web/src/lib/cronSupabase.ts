import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  CRON_SUPABASE_TIMEOUT_MS,
  createTimedFetch,
} from "@/lib/cronTimeouts";
import {
  getSupabaseSecretKey,
  getSupabaseUrl,
} from "@/lib/supabaseEnv";

export function buildCronSupabaseAdmin(
  timeoutMs = CRON_SUPABASE_TIMEOUT_MS
): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: createTimedFetch(timeoutMs),
    },
  });
}
