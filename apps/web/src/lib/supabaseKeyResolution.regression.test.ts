import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(process.cwd(), "../..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "scripts" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === "coverage" ||
        entry.name === "Backups" ||
        entry.name === "android" ||
        entry.name === "ios"
      ) {
        continue;
      }
      walk(full, out);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    if (/\.(test|integration)\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

test("web, mobile, and Edge prefer the publishable and secret keys", () => {
  const web = read("apps/web/src/lib/supabaseEnv.ts");
  assert.match(
    web,
    /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY/,
  );
  assert.match(web, /SUPABASE_SECRET_KEY[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);

  const mobile = read("apps/mobile/lib/supabase.ts");
  assert.match(
    mobile,
    /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY[\s\S]*EXPO_PUBLIC_SUPABASE_ANON_KEY/,
  );
  assert.doesNotMatch(mobile, /sb_secret|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/);

  const appConfig = read("app.config.ts");
  assert.match(
    appConfig,
    /EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY[\s\S]*EXPO_PUBLIC_SUPABASE_ANON_KEY/,
  );

  const edge = read("supabase/functions/_shared/supabaseKeys.ts");
  assert.match(edge, /SUPABASE_PUBLISHABLE_KEY[\s\S]*SUPABASE_ANON_KEY/);
  assert.match(edge, /SUPABASE_SECRET_KEY[\s\S]*SUPABASE_SECRET_KEYS[\s\S]*SUPABASE_SERVICE_ROLE_KEY/);
});

test("runtime files do not read a legacy Supabase key without the new key", () => {
  const roots = [
    path.join(repoRoot, "apps"),
    path.join(repoRoot, "supabase", "functions"),
    path.join(repoRoot, "app.config.ts"),
  ];
  const files = roots.flatMap((root) =>
    fs.existsSync(root) && fs.statSync(root).isDirectory() ? walk(root) : [root],
  );
  const legacyAnonOnly: string[] = [];
  const legacySecretOnly: string[] = [];

  for (const file of files) {
    const text = fs
      .readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const relative = path.relative(repoRoot, file);
    const usesLegacyAnon =
      text.includes("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      text.includes("EXPO_PUBLIC_SUPABASE_ANON_KEY") ||
      text.includes("SUPABASE_ANON_KEY");
    const usesPublishable =
      text.includes("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
      text.includes("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
      text.includes("SUPABASE_PUBLISHABLE_KEY") ||
      text.includes("getSupabasePublishableKey") ||
      text.includes("getEdgePublishableKey");
    if (usesLegacyAnon && !usesPublishable) legacyAnonOnly.push(relative);

    const usesLegacySecret = text.includes("SUPABASE_SERVICE_ROLE_KEY");
    const usesSecret =
      text.includes("SUPABASE_SECRET_KEY") ||
      text.includes("getSupabaseSecretKey") ||
      text.includes("getEdgeSecretKey");
    if (usesLegacySecret && !usesSecret) legacySecretOnly.push(relative);
  }

  assert.deepEqual(legacyAnonOnly, []);
  assert.deepEqual(legacySecretOnly, []);
});
