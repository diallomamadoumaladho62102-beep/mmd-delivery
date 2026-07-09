import assert from "node:assert/strict";
import { getDistanceAndEta } from "./mapboxRoute";

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const prev = {
    MAPBOX_ACCESS_TOKEN: env.MAPBOX_ACCESS_TOKEN,
    NEXT_PUBLIC_MAPBOX_TOKEN: env.NEXT_PUBLIC_MAPBOX_TOKEN,
  };

  const originalFetch = globalThis.fetch;

  try {
    delete env.MAPBOX_ACCESS_TOKEN;
    env.NEXT_PUBLIC_MAPBOX_TOKEN = "pk.public-must-not-be-used";

    await assert.rejects(
      () =>
        getDistanceAndEta(
          { lat: 40.7, lng: -74.0 },
          { lat: 40.8, lng: -73.9 }
        ),
      /MAPBOX_ACCESS_TOKEN missing/
    );

    env.MAPBOX_ACCESS_TOKEN = "pk.server";

    let seenUrl = "";
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ message: "Service Unavailable" }), {
        status: 503,
      });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        getDistanceAndEta(
          { lat: 40.7, lng: -74.0 },
          { lat: 40.8, lng: -73.9 }
        ),
      /Mapbox Directions unavailable \(503\)/
    );

    assert.match(seenUrl, /access_token=pk\.server/);
    assert.doesNotMatch(seenUrl, /pk\.public-must-not-be-used/);

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ routes: [] }), {
        status: 200,
      })) as typeof fetch;

    await assert.rejects(
      () =>
        getDistanceAndEta(
          { lat: 40.7, lng: -74.0 },
          { lat: 40.8, lng: -73.9 }
        ),
      /no usable route/
    );

    console.log("mapboxRoute.test.ts OK");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete env[k];
      else env[k] = v;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
