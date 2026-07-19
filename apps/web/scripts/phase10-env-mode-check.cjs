const fs = require("fs");
const { spawnSync } = require("child_process");

function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = {
  ...loadEnv(".env"),
  ...loadEnv(".env.local"),
  ...process.env,
};

function report(name) {
  const v = String(env[name] || "");
  let mode = "absent";
  if (v) {
    if (
      v.startsWith("sk_test") ||
      v.startsWith("pk_test") ||
      v.startsWith("rk_test")
    ) {
      mode = "test";
    } else if (
      v.startsWith("sk_live") ||
      v.startsWith("pk_live") ||
      v.startsWith("rk_live")
    ) {
      mode = "live";
    } else {
      mode = "present";
    }
  }
  const sensitive = /(SECRET|KEY|TOKEN|PASSWORD|SERVICE_ROLE)/i.test(name);
  console.log(
    `${name}: present=${Boolean(v)} mode=${mode} sensitive=${sensitive}`
  );
}

[
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERCEL_ENV",
  "APP_ENV",
  "CRON_SECRET",
].forEach(report);

const stripe = spawnSync("stripe", ["--version"], { encoding: "utf8" });
const supabase = spawnSync("supabase", ["--version"], { encoding: "utf8" });
console.log(`stripe_cli=${stripe.status === 0 ? "yes" : "no"}`);
console.log(`supabase_cli=${supabase.status === 0 ? "yes" : "no"}`);
