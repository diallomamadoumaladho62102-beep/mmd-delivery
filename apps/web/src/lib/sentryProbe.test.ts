import assert from "node:assert/strict";
import {
  buildSentryProbeMessage,
  readWebSentryDsnConfigured,
  SENTRY_PROBE_TAG,
} from "./sentryProbe";

const env = process.env as Record<string, string | undefined>;
const prev = {
  NEXT_PUBLIC_SENTRY_DSN: env.NEXT_PUBLIC_SENTRY_DSN,
  SENTRY_DSN: env.SENTRY_DSN,
};

try {
  delete env.NEXT_PUBLIC_SENTRY_DSN;
  delete env.SENTRY_DSN;
  let cfg = readWebSentryDsnConfigured();
  assert.equal(cfg.configured, false);
  assert.equal(cfg.sources.NEXT_PUBLIC_SENTRY_DSN, false);
  assert.equal(cfg.sources.SENTRY_DSN, false);

  env.NEXT_PUBLIC_SENTRY_DSN = "https://examplePublic@o0.ingest.sentry.io/1";
  cfg = readWebSentryDsnConfigured();
  assert.equal(cfg.configured, true);
  assert.equal(cfg.sources.NEXT_PUBLIC_SENTRY_DSN, true);

  delete env.NEXT_PUBLIC_SENTRY_DSN;
  env.SENTRY_DSN = "https://exampleServer@o0.ingest.sentry.io/1";
  cfg = readWebSentryDsnConfigured();
  assert.equal(cfg.configured, true);
  assert.equal(cfg.sources.SENTRY_DSN, true);

  const msg = buildSentryProbeMessage("web");
  assert.match(msg, /^MMD Sentry web probe /);
  assert.equal(SENTRY_PROBE_TAG, "mmd_sentry_probe");

  console.log("sentryProbe.test.ts OK");
} finally {
  for (const [k, v] of Object.entries(prev)) {
    if (v == null) delete env[k];
    else env[k] = v;
  }
}
