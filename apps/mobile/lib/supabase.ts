// apps/mobile/lib/supabase.ts
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import { createSecureAuthStorage } from "./secureAuthStorage";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  String(extra.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? "").trim();

const supabasePublishableKey = String(
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    extra.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ""
).trim();

if (!supabaseUrl || !supabasePublishableKey) {
  console.error(
    "[MMD-BOOT] Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  );
}

// Never throw at module import — supabase-js throws if url/key are empty.
const resolvedSupabaseUrl =
  supabaseUrl || "https://invalid.supabase.co";
const resolvedSupabasePublishableKey =
  supabasePublishableKey || "missing-supabase-publishable-key";

export const supabaseConfigured = Boolean(supabaseUrl && supabasePublishableKey);

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
  }
);
