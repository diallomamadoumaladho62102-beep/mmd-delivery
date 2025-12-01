import { createClient } from "@supabase/supabase-js";

const URL           = process.env.SUPABASE_URL;
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE;
const EMAIL         = process.env.TARGET_USER_EMAIL;
const REDIRECT_TO   = process.env.REDIRECT_TO || "http://localhost:3000/auth/whoami";

if (!URL || !SERVICE_ROLE || !EMAIL) {
  console.error("Missing env vars. Need SUPABASE_URL, SUPABASE_SERVICE_ROLE, TARGET_USER_EMAIL");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_ROLE);

try {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: EMAIL,
    options: { redirectTo: REDIRECT_TO }
  });
  if (error) {
    console.error("❌ generateLink error:", error);
    process.exit(1);
  }
  console.log("✅ Recovery link generated:");
  console.log(data?.properties?.action_link || data?.action_link || data?.link || JSON.stringify(data, null, 2));
} catch (e) {
  console.error("💥 Exception:", e);
  process.exit(1);
}
