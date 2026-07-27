import assert from "node:assert/strict";
import {
  haversineMeters,
  opsRouteCacheKey,
  resolveOpsMapDrivingRoute,
  straightLineRoute,
  mapPool,
  OPS_ROUTE_MOVE_THRESHOLD_M,
} from "./opsMapDirections";
import { cacheClearForTests } from "./memoryCache";

function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok ${name}`))
    .catch((e) => {
      console.error(`FAIL ${name}`);
      throw e;
    });
}

async function main() {
  const env = process.env as Record<string, string | undefined>;
  const prevToken = env.MAPBOX_ACCESS_TOKEN;
  const originalFetch = globalThis.fetch;

  try {
    cacheClearForTests();
    env.MAPBOX_ACCESS_TOKEN = "pk.test-ops";

    await test("straightLineRoute builds coords and ETA", () => {
      const r = straightLineRoute(
        [
          { lat: 40.7, lng: -74.0 },
          { lat: 40.71, lng: -74.01 },
        ],
        12
      );
      assert.equal(r.source, "straight");
      assert.equal(r.coordinates.length, 2);
      assert.equal(r.etaMinutes, 12);
    });

    await test("opsRouteCacheKey is mission-scoped", () => {
      assert.equal(opsRouteCacheKey("m1"), "ops-route:m1");
      assert.equal(
        opsRouteCacheKey("m1", [{ lat: 1, lng: 2 }]),
        opsRouteCacheKey("m1")
      );
    });

    await test("haversineMeters is ~0 for same point", () => {
      assert.ok(
        haversineMeters(
          { lat: 40.7, lng: -74 },
          { lat: 40.7, lng: -74 }
        ) < 1
      );
      assert.ok(
        haversineMeters(
          { lat: 40.7, lng: -74 },
          { lat: 40.701, lng: -74 }
        ) > OPS_ROUTE_MOVE_THRESHOLD_M / 2 ||
          haversineMeters(
            { lat: 40.7, lng: -74 },
            { lat: 40.701, lng: -74 }
          ) > 50
      );
    });

    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      return new Response(
        JSON.stringify({
          routes: [
            {
              distance: 1609.34,
              duration: 600,
              geometry: {
                coordinates: [
                  [-74.0, 40.7],
                  [-73.99, 40.705],
                  [-73.98, 40.71],
                ],
              },
            },
          ],
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    await test("resolveOpsMapDrivingRoute uses Mapbox geometry + ETA", async () => {
      cacheClearForTests();
      fetchCount = 0;
      const r = await resolveOpsMapDrivingRoute({
        missionId: "order-1",
        waypoints: [
          { lat: 40.7, lng: -74.0 },
          { lat: 40.71, lng: -73.98 },
        ],
        fallbackEtaMinutes: 99,
      });
      assert.equal(r.source, "mapbox");
      assert.equal(r.etaMinutes, 10);
      assert.equal(r.coordinates.length, 3);
      assert.equal(fetchCount, 1);
    });

    await test("second resolve hits cache without network", async () => {
      fetchCount = 0;
      const r = await resolveOpsMapDrivingRoute({
        missionId: "order-1",
        waypoints: [
          { lat: 40.7, lng: -74.0 },
          { lat: 40.71, lng: -73.98 },
        ],
      });
      assert.equal(r.source, "cache");
      assert.equal(fetchCount, 0);
    });

    await test("Directions failure falls back to straight line", async () => {
      cacheClearForTests();
      globalThis.fetch = (async () =>
        new Response("boom", { status: 429 })) as typeof fetch;
      const r = await resolveOpsMapDrivingRoute({
        missionId: "order-fail",
        waypoints: [
          { lat: 40.7, lng: -74.0 },
          { lat: 40.8, lng: -73.9 },
        ],
        fallbackEtaMinutes: 22,
      });
      assert.equal(r.source, "straight");
      assert.equal(r.etaMinutes, 22);
      assert.equal(r.coordinates.length, 2);
    });

    await test("mapPool respects concurrency", async () => {
      let concurrent = 0;
      let maxConcurrent = 0;
      const items = [1, 2, 3, 4, 5];
      const out = await mapPool(items, 2, async (n) => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 20));
        concurrent -= 1;
        return n * 2;
      });
      assert.deepEqual(out, [2, 4, 6, 8, 10]);
      assert.ok(maxConcurrent <= 2);
    });

    console.log("opsMapDirections tests passed");
  } finally {
    globalThis.fetch = originalFetch;
    if (prevToken == null) delete env.MAPBOX_ACCESS_TOKEN;
    else env.MAPBOX_ACCESS_TOKEN = prevToken;
    cacheClearForTests();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
