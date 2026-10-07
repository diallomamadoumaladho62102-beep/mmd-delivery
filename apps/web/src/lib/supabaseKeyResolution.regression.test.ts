import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  getSupabasePublishableKey,
  getSupabaseSecretKey,
} from "./supabaseEnv";

const LEGACY_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

const DETECTOR_FILES = new Set([
  "scripts/secret-scan.mjs",
  "scripts/verify-b6-eas-secrets.mjs",
]);

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (
      fs.existsSync(path.join(dir, "apps", "web", "src", "lib", "supabaseEnv.ts")) &&
      fs.existsSync(path.join(dir, "supabase", "functions", "_shared", "supabaseKeys.ts"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate the repository root");
}

const repoRoot = findRepoRoot();

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".next" ||
        entry.name === "dist" ||
        entry.name === "coverage" ||
        entry.name === "Backups" ||
        entry.name === "android" ||
        entry.name === "ios" ||
        entry.name === "migrations"
      ) {
        continue;
      }
      walk(full, out);
      continue;
    }
    if (!/\.(ts|tsx|js|mjs|jsx)$/.test(entry.name)) continue;
    if (/\.(test|integration)\.(ts|tsx|js|mjs)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

function snapshotEnv(): Map<string, string | undefined> {
  return new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved: Map<string, string | undefined>) {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("runtime source does not read legacy Supabase API key names", () => {
  const roots = [
    path.join(repoRoot, "apps"),
    path.join(repoRoot, "supabase", "functions"),
    path.join(repoRoot, "scripts"),
    path.join(repoRoot, "app.config.ts"),
  ];
  const files = roots.flatMap((root) =>
    fs.existsSync(root) && fs.statSync(root).isDirectory() ? walk(root) : [root]
  );
  const offenders: string[] = [];
  for (const file of files) {
    const relative = path.relative(repoRoot, file).split(path.sep).join("/");
    if (DETECTOR_FILES.has(relative)) continue;
    const text = stripComments(fs.readFileSync(file, "utf8"));
    for (const name of LEGACY_ENV_NAMES) {
      if (text.includes(name)) offenders.push(`${relative} ${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("publishable key present configures the browser client", () => {
  const saved = snapshotEnv();
  try {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_config_test";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    const key = getSupabasePublishableKey();
    assert.equal(key, "sb_publishable_config_test");
    assert.equal(key.startsWith("sb_publishable_"), true);
  } finally {
    restoreEnv(saved);
  }
});

test("secret key present configures the privileged server client", () => {
  const saved = snapshotEnv();
  try {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_config_test";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const key = getSupabaseSecretKey();
    assert.equal(key, "sb_secret_config_test");
    assert.equal(key.startsWith("sb_secret_"), true);
  } finally {
    restoreEnv(saved);
  }
});

test("missing publishable key is a configuration error", () => {
  const saved = snapshotEnv();
  try {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "legacy-anon-must-not-be-used";
    process.env.SUPABASE_ANON_KEY = "legacy-anon-must-not-be-used";
    assert.throws(
      () => getSupabasePublishableKey(),
      /Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/
    );
  } finally {
    restoreEnv(saved);
  }
});

test("missing secret key is a configuration error", () => {
  const saved = snapshotEnv();
  try {
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy-service-must-not-be-used";
    assert.throws(() => getSupabaseSecretKey(), /Missing SUPABASE_SECRET_KEY/);
  } finally {
    restoreEnv(saved);
  }
});

test("browser client does not depend on a legacy anon key", () => {
  const saved = snapshotEnv();
  try {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_config_test";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    assert.equal(getSupabasePublishableKey(), "sb_publishable_config_test");
  } finally {
    restoreEnv(saved);
  }
});

test("privileged server does not depend on a legacy service key", () => {
  const saved = snapshotEnv();
  try {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_config_test";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(getSupabaseSecretKey(), "sb_secret_config_test");
  } finally {
    restoreEnv(saved);
  }
});

test("a secret key is rejected in the publishable slot", () => {
  const saved = snapshotEnv();
  try {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_secret_config_test";
    assert.throws(
      () => getSupabasePublishableKey(),
      /must not be a secret key/
    );
  } finally {
    restoreEnv(saved);
  }
});

test("a publishable key is rejected in the secret slot", () => {
  const saved = snapshotEnv();
  try {
    process.env.SUPABASE_SECRET_KEY = "sb_publishable_config_test";
    assert.throws(
      () => getSupabaseSecretKey(),
      /must not be a publishable key/
    );
  } finally {
    restoreEnv(saved);
  }
});
