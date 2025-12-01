import { createClient } from "@supabase/supabase-js";

const URL           = process.env.SUPABASE_URL;
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE;
const USER_ID       = process.env.TARGET_USER_ID;
const USER_EMAIL    = process.env.TARGET_USER_EMAIL;   // optionnel, pour fallback
const NEW_PASSWORD  = process.env.NEW_PASSWORD;

function req(name, v){ if(!v){ console.error(`Missing env: ${name}`); process.exit(1); } }

req("SUPABASE_URL", URL);
req("SUPABASE_SERVICE_ROLE", SERVICE_ROLE);
req("TARGET_USER_ID", USER_ID);
req("NEW_PASSWORD", NEW_PASSWORD);

console.log("➡️ Using project:", URL);
console.log("➡️ Target user id:", USER_ID);
if (USER_EMAIL) console.log("➡️ Target email   :", USER_EMAIL);

const admin = createClient(URL, SERVICE_ROLE);

try {
  // 1) Vérifier que l'API répond et que la clé est valide
  const ping = await admin.from("users").select("id").limit(1);
  if (ping.error) {
    console.error("❌ Admin ping failed:", ping.error);
  } else {
    console.log("✅ Admin ping ok (RLS bypass)");
  }

  // 2) Confirmer que l'ID correspond à un user de CE projet
  const u = await admin.auth.admin.getUserById(USER_ID);
  if (u.error) {
    console.error("❌ getUserById error:", u.error);
  } else {
    console.log("👤 User found by id:", u.data.user?.email, u.data.user?.id);
  }

  // 3) Si pas trouvé par ID et email fourni → tenter listUsers + filtre email
  let userId = USER_ID;
  if ((!u.data || !u.data.user) && USER_EMAIL) {
    const list = await admin.auth.admin.listUsers();
    if (list.error) {
      console.error("❌ listUsers error:", list.error);
    } else {
      const match = list.data.users.find(x => (x.email || "").toLowerCase() === USER_EMAIL.toLowerCase());
      if (match) {
        userId = match.id;
        console.log("🔁 Resolved userId by email:", userId);
      } else {
        console.error("❌ Email not found among users");
      }
    }
  }

  // 4) Tenter update du mot de passe
  const upd = await admin.auth.admin.updateUserById(userId, { password: NEW_PASSWORD });
  if (upd.error) {
    console.error("❌ Update failed:", upd.error);
    process.exit(1);
  }
  console.log("✅ Password updated for", userId);

} catch (e) {
  console.error("💥 Exception:", e);
  process.exit(1);
}
