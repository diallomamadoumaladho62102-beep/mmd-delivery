import assert from "node:assert/strict";
import { isAllowedDriverDocUpload } from "./driverDocUpload";

assert.equal(isAllowedDriverDocUpload({ byteLength: 0, mime: "image/jpeg" }).ok, false);
assert.equal(
  (isAllowedDriverDocUpload({ byteLength: 0, mime: "image/jpeg" }) as { reason: string })
    .reason,
  "empty",
);
assert.equal(
  isAllowedDriverDocUpload({ byteLength: 12, mime: "application/octet-stream" }).ok,
  false,
);
assert.equal(
  isAllowedDriverDocUpload({ byteLength: 12 * 1024 * 1024, mime: "image/png" }).ok,
  false,
);
assert.equal(isAllowedDriverDocUpload({ byteLength: 120, mime: "image/jpeg" }).ok, true);
assert.equal(isAllowedDriverDocUpload({ byteLength: 120, mime: "image/png" }).ok, true);
assert.equal(isAllowedDriverDocUpload({ byteLength: 120, mime: "application/pdf" }).ok, true);

console.log("driverDocUpload.test.ts — PASS");
