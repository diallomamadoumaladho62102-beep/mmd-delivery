import assert from "node:assert/strict";
import {
  formatCoordAddress,
  reverseGeocodeCacheKey,
} from "./reverseGeocodePure";

function testCacheKeyRounding() {
  assert.equal(
    reverseGeocodeCacheKey(40.71284, -74.00601),
    reverseGeocodeCacheKey(40.71281, -74.00602)
  );
  assert.notEqual(
    reverseGeocodeCacheKey(40.7128, -74.006),
    reverseGeocodeCacheKey(40.7139, -74.006)
  );
}

function testCoordFallbackFormat() {
  const addr = formatCoordAddress(40.7128, -74.006);
  assert.equal(addr, "40.71280, -74.00600");
}

testCacheKeyRounding();
testCoordFallbackFormat();

console.log("reverseGeocode.test.ts OK");
