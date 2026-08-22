/**
 * Regression: taxi driver APIs enforce ride ownership before GPS / lifecycle actions.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

for (const rel of [
  "app/api/taxi/rides/arrive/route.ts",
  "app/api/taxi/rides/complete/route.ts",
  "app/api/taxi/offers/reject/route.ts",
  "app/api/taxi/rides/[id]/route.ts",
]) {
  const src = fs.readFileSync(path.join(webRoot, rel), "utf8");
  assert.match(
    src,
    /assertDriverOwnsTaxiRide|driver_id.*auth\.user|eq\("driver_id"/,
    `${rel} must scope to authenticated driver`,
  );
}

const createSrc = fs.readFileSync(
  path.join(webRoot, "app/api/taxi/rides/create/route.ts"),
  "utf8",
);
assert.match(createSrc, /client_user_id|auth\.user\.id/);

console.log("taxiRideOwnershipSecurity.regression.test.ts OK");
