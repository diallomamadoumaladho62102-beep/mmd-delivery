import { createClient } from "@supabase/supabase-js";
import {
  getSupabasePublishableKeyOptional,
  getSupabaseUrlOptional,
} from "@/lib/supabaseEnv";

const supabaseUrl = getSupabaseUrlOptional();
const supabasePublishableKey = getSupabasePublishableKeyOptional();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Supabase env manquants (URL ou PUBLISHABLE/ANON KEY). Vérifie .env.local"
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
