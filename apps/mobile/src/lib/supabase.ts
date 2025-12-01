// apps/mobile/src/lib/supabase.ts

import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = "https://sjmszohmhudayxawfows.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqbXN6b2htaHVkYXl4YXdmb3dzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA2MDc0NDcsImV4cCI6MjA3NjE4MzQ0N30.v1EJ6jTd-SM8KwWUEoX1ysMzj3BLlraxTu23ay6A_Eo";

console.log("MMD MOBILE SUPABASE_URL =", SUPABASE_URL);
console.log(
  "MMD MOBILE SUPABASE_ANON_KEY length =",
  SUPABASE_ANON_KEY ? SUPABASE_ANON_KEY.length : "MISSING"
);

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
