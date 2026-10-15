// apps/mobile/lib/supabase.ts
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { createSecureAuthStorage } from "./secureAuthStorage";
import { isPrivilegedSupabaseClientKey } from "../../../shared/supabaseClientKeyGuard";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  String(extra.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? "").trim();

const configuredPublishableKey = String(
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    extra.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ""
).trim();
const supabasePublishableKey = isPrivilegedSupabaseClientKey(configuredPublishableKey)
  ? ""
  : configuredPublishableKey;

if (configuredPublishableKey && !supabasePublishableKey) {
  console.error("[MMD-BOOT] Refusing a privileged Supabase key in the client slot");
}

export const SUPABASE_MISSING_CONFIG_MESSAGE =
  "Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, then restart Metro.";

if (!supabaseUrl || !supabasePublishableKey) {
  console.error(`[MMD-BOOT] ${SUPABASE_MISSING_CONFIG_MESSAGE}`);
}

// Never throw at module import — supabase-js throws if url/key are empty.
// The placeholder is not an API key and is never sent: requests fail locally
// with SUPABASE_MISSING_CONFIG_MESSAGE instead of "Invalid API key".
const resolvedSupabaseUrl = supabaseUrl || "https://invalid.supabase.co";
const resolvedSupabasePublishableKey = supabasePublishableKey || "unconfigured";

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

function rejectUnconfiguredSupabaseRequest(): Promise<Response> {
  return Promise.reject(new Error(SUPABASE_MISSING_CONFIG_MESSAGE));
}

export const supabase = createClient(
  resolvedSupabaseUrl,
  resolvedSupabasePublishableKey,
  {
    auth: {
      storage: createSecureAuthStorage(),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false, // mobile => pas d’URL callback
    },
    ...(supabaseConfigured
      ? {}
      : { global: { fetch: rejectUnconfiguredSupabaseRequest } }),
  }
);
