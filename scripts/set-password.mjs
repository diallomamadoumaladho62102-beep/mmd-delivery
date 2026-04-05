import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const USER_ID = process.env.TARGET_USER_ID;
const NEW_PASSWORD = process.env.NEW_PASSWORD;

if (!URL || !SERVICE_ROLE || !USER_ID || !NEW_PASSWORD) {
  console.error("Missing env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE, TARGET_USER_ID, NEW_PASSWORD");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_ROLE);
const { data, error } = await admin.auth.admin.updateUserById(USER_ID, { password: NEW_PASSWORD });

if (error) {
  console.error("❌ Failed:", error.message);
  process.exit(1);
}
console.log("✅ Password updated for", USER_ID);
