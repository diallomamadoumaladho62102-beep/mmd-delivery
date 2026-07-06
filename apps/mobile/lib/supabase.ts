// apps/mobile/lib/supabase.ts
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  String(extra.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? "").trim();

const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  String(extra.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("[MMD-BOOT] Missing Supabase env:", {
    hasUrl: !!supabaseUrl,
    hasAnonKey: !!supabaseAnonKey,
  });
}

// Never throw at module import — supabase-js throws if url/key are empty.
const resolvedSupabaseUrl =
  supabaseUrl || "https://invalid.supabase.co";
const resolvedSupabaseAnonKey =
  supabaseAnonKey || "missing-supabase-anon-key";

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(resolvedSupabaseUrl, resolvedSupabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // mobile => pas d’URL callback
  },
});