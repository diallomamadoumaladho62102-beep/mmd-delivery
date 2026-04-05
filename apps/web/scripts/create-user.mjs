import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function decodeJwtRole(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64").toString("utf8"));
    return payload?.role || "(inconnu)";
  } catch {
    return "(illisible)";
  }
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE;

console.log("🔧 SUPABASE_URL:", url || "(vide)");
console.log("🔧 SERVICE_ROLE length:", key ? key.length : 0);

if (!url || !key) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
  process.exit(1);
}

const role = decodeJwtRole(key);
console.log("🔎 SERVICE_ROLE claims.role:", role);

if (role !== "service_role") {
  console.error("❌ Cette clé n'est pas une Service Role Key (role=" + role + "). Récupère la clé Service Role dans Supabase > Project Settings > API.");
  process.exit(1);
}

const supabase = createClient(url, key);

const email    = process.env.NEW_USER_EMAIL     || "maladho516gn@gmail.com";
const password = process.env.NEW_USER_PASSWORD  || "Mmd#2025Driver!";

try {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: "Mamadou (admin)" },
  });

  if (error) {
    console.error("❌ createUser failed:", error);
    process.exit(1);
  }

  console.log("✅ User created:", data.user.id, data.user.email);
} catch (e) {
  console.error("❌ Unexpected error:", e);
  process.exit(1);
}
