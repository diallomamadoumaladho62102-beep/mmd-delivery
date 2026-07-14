"use client";
import { createClient } from "@supabase/supabase-js";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabaseEnv";

export const supabase = createClient(
  getSupabaseUrl(),
  getSupabasePublishableKey(),
  { auth: { persistSession: true, autoRefreshToken: true } }
);
