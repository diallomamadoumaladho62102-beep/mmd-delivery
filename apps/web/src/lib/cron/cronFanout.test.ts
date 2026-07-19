import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  isHobbySafeDailyCron,
  resolveCronBaseUrl,
} from "@/lib/cron/cronFanout";

test("isHobbySafeDailyCron accepts once-daily expressions", () => {
  assert.equal(isHobbySafeDailyCron("15 4 * * *"), true);
  assert.equal(isHobbySafeDailyCron("30 5 * * *"), true);
  assert.equal(isHobbySafeDailyCron("0 3 * * 0"), true);
});

test("isHobbySafeDailyCron rejects sub-daily expressions", () => {
  assert.equal(isHobbySafeDailyCron("15 * * * *"), false);
  assert.equal(isHobbySafeDailyCron("*/15 * * * *"), false);
  assert.equal(isHobbySafeDailyCron("0,30 4 * * *"), false);
  assert.equal(isHobbySafeDailyCron("0 */2 * * *"), false);
});

test("vercel.json exposes exactly two Hobby-safe daily crons", () => {
  const root = join(process.cwd(), "vercel.json");
  const web = join(process.cwd(), "vercel.json");
  // When cwd is apps/web, local vercel.json is the app copy.
  const raw = readFileSync(web, "utf8");
  const parsed = JSON.parse(raw) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  assert.ok(Array.isArray(parsed.crons));
  assert.equal(parsed.crons!.length, 2);
  const paths = parsed.crons!.map((c) => c.path).sort();
  assert.deepEqual(paths, ["/api/cron/daily-money", "/api/cron/daily-ops"]);
  for (const c of parsed.crons!) {
    assert.equal(
      isHobbySafeDailyCron(c.schedule),
      true,
      `unsafe schedule: ${c.path} ${c.schedule}`
    );
  }
  void root;
});

test("resolveCronBaseUrl prefers CRON_BASE_URL then VERCEL_URL", () => {
  const env = process.env as Record<string, string | undefined>;
  const prev = {
    CRON_BASE_URL: env.CRON_BASE_URL,
    VERCEL_URL: env.VERCEL_URL,
    NEXT_PUBLIC_SITE_URL: env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL,
  };
  try {
    delete env.CRON_BASE_URL;
    delete env.NEXT_PUBLIC_SITE_URL;
    delete env.NEXT_PUBLIC_APP_URL;
    env.VERCEL_URL = "my-app.vercel.app";
    assert.equal(resolveCronBaseUrl(), "https://my-app.vercel.app");
    env.CRON_BASE_URL = "https://example.test/";
    assert.equal(resolveCronBaseUrl(), "https://example.test");
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete env[k];
      else env[k] = v;
    }
  }
});

console.log("cronFanout tests passed");
