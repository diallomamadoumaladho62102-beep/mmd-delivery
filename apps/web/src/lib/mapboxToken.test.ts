import assert from "node:assert/strict";
import {
  assertMapboxEnvConfigured,
  getPublicMapboxToken,
  getServerMapboxToken,
  tryGetServerMapboxToken,
} from "./mapboxToken";

const env = process.env as Record<string, string | undefined>;
const prev = {
  MAPBOX_ACCESS_TOKEN: env.MAPBOX_ACCESS_TOKEN,
  NEXT_PUBLIC_MAPBOX_TOKEN: env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,
};

try {
  delete env.MAPBOX_ACCESS_TOKEN;
  delete env.NEXT_PUBLIC_MAPBOX_TOKEN;
  delete env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  assert.equal(tryGetServerMapboxToken(), null);
  assert.throws(() => getServerMapboxToken(), /MAPBOX_ACCESS_TOKEN missing/);
  assert.equal(getPublicMapboxToken(), null);

  env.MAPBOX_ACCESS_TOKEN = "pk.server";
  assert.equal(getServerMapboxToken(), "pk.server");
  assert.equal(tryGetServerMapboxToken(), "pk.server");

  env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.public";
  assert.equal(getPublicMapboxToken(), "pk.public");

  delete env.NEXT_PUBLIC_MAPBOX_TOKEN;
  env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN = "pk.legacy";
  assert.equal(getPublicMapboxToken(), "pk.legacy");

  const check = assertMapboxEnvConfigured();
  assert.equal(check.ok, true);
  assert.equal(check.server, true);
  assert.equal(check.public, true);

  console.log("mapboxToken.test.ts OK");
} finally {
  for (const [k, v] of Object.entries(prev)) {
    if (v == null) delete env[k];
    else env[k] = v;
  }
}
