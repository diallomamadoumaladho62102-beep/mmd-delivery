import assert from "node:assert/strict";

/** URL builders — same contract as externalNavigationApps.ts and DriverOrderDetailsScreen. */
function googleMapsUrl(
  platform: "ios" | "android",
  lat: number,
  lng: number,
): string {
  return platform === "ios"
    ? `http://maps.apple.com/?daddr=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

function wazeDeepLink(lat: number, lng: number): string {
  return `waze://?ll=${lat},${lng}&navigate=yes`;
}

function wazeFallback(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
}

const lat = 48.856613;
const lng = 2.352242;

assert.equal(
  googleMapsUrl("android", lat, lng),
  "https://www.google.com/maps/dir/?api=1&destination=48.856613,2.352242&travelmode=driving",
);
assert.equal(
  googleMapsUrl("ios", lat, lng),
  "http://maps.apple.com/?daddr=48.856613,2.352242",
);
assert.equal(wazeDeepLink(lat, lng), "waze://?ll=48.856613,2.352242&navigate=yes");
assert.equal(
  wazeFallback(lat, lng),
  "https://waze.com/ul?ll=48.856613,2.352242&navigate=yes",
);

console.log("externalNavigationUrls.test.ts OK");
