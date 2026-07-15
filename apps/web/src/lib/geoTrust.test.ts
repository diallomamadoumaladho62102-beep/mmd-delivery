import assert from "node:assert/strict";
import {
  evaluateLocationClaim,
  evaluateServerRoute,
  type GeoEvidence,
} from "./geoTrust";

function evidence(input: Partial<GeoEvidence> = {}): GeoEvidence {
  return {
    countryCode: "US",
    region: "New York",
    label: "350 5th Avenue, New York, New York 10118, United States",
    placeTypes: ["address"],
    center: { lat: 40.7484, lng: -73.9857 },
    ...input,
  };
}

function expectFailure(
  result: ReturnType<typeof evaluateLocationClaim>,
  code: string,
) {
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, code);
}

// Valid structured US address + coordinates.
assert.equal(
  evaluateLocationClaim(
    {
      role: "pickup",
      address: "350 5th Avenue, New York",
      claimedCountryCode: "US",
      claimedRegion: "New York",
      lat: 40.7484,
      lng: -73.9857,
    },
    evidence(),
    evidence(),
  ).ok,
  true,
);

// Invalid latitude / longitude and impossible Gulf of Guinea null island.
expectFailure(
  evaluateLocationClaim(
    { role: "pickup", lat: 91, lng: -73, claimedCountryCode: "US" },
    evidence(),
  ),
  "invalid_coordinates",
);
expectFailure(
  evaluateLocationClaim(
    { role: "pickup", lat: 0, lng: 0, claimedCountryCode: "GN" },
    evidence({ countryCode: "GN" }),
  ),
  "invalid_coordinates",
);

// Address and pin are materially inconsistent.
expectFailure(
  evaluateLocationClaim(
    {
      role: "dropoff",
      address: "Dakar Plateau",
      claimedCountryCode: "US",
      lat: 40.7484,
      lng: -73.9857,
    },
    evidence(),
    evidence({
      label: "Dakar Plateau, Senegal",
      countryCode: "SN",
      center: { lat: 14.6937, lng: -17.4441 },
    }),
  ),
  "address_coordinate_mismatch",
);

// Claimed country cannot override reverse-geocoded country.
expectFailure(
  evaluateLocationClaim(
    {
      role: "pickup",
      address: "Empire State Building",
      claimedCountryCode: "GN",
      lat: 40.7484,
      lng: -73.9857,
    },
    evidence(),
  ),
  "country_mismatch",
);

// Parking / airports get a larger but bounded tolerance.
assert.equal(
  evaluateLocationClaim(
    {
      role: "pickup",
      address: "JFK Airport Terminal 4 parking",
      claimedCountryCode: "US",
      lat: 40.644,
      lng: -73.782,
    },
    evidence({
      label: "John F Kennedy International Airport, Queens, New York",
      placeTypes: ["poi"],
      center: { lat: 40.6413, lng: -73.7781 },
    }),
    evidence({
      label: "JFK Airport Terminal 4",
      placeTypes: ["poi"],
      center: { lat: 40.645, lng: -73.782 },
    }),
  ).ok,
  true,
);

// Africa: no street number required; landmark text is valid.
assert.equal(
  evaluateLocationClaim(
    {
      role: "dropoff",
      address: "près du marché Madina, Conakry",
      claimedCountryCode: "GN",
      lat: 9.55,
      lng: -13.67,
    },
    evidence({
      countryCode: "GN",
      region: "Conakry",
      label: "Marché Madina, Conakry, Guinée",
      placeTypes: ["poi"],
      center: { lat: 9.552, lng: -13.672 },
    }),
    evidence({
      countryCode: "GN",
      label: "Marché Madina, Conakry",
      placeTypes: ["poi"],
      center: { lat: 9.552, lng: -13.672 },
    }),
  ).ok,
  true,
);

// Low GPS accuracy is a warning, not a legitimate-user blocker.
const lowAccuracy = evaluateLocationClaim(
  {
    role: "pickup",
    address: "JFK Airport",
    claimedCountryCode: "US",
    accuracyMeters: 220,
    lat: 40.6413,
    lng: -73.7781,
  },
  evidence({
    label: "John F Kennedy International Airport",
    placeTypes: ["poi"],
    center: { lat: 40.6413, lng: -73.7781 },
  }),
);
assert.equal(lowAccuracy.ok, true);
if (lowAccuracy.ok) assert.ok(lowAccuracy.warnings.includes("low_gps_accuracy"));

// Paid route distance always comes from server and is bounded.
assert.equal(
  evaluateServerRoute({
    pickup: { lat: 40.7484, lng: -73.9857 },
    dropoff: { lat: 40.758, lng: -73.9855 },
    serverDistanceMiles: 1.1,
  }).ok,
  true,
);
assert.deepEqual(
  evaluateServerRoute({
    pickup: { lat: 40.7484, lng: -73.9857 },
    dropoff: { lat: 40.758, lng: -73.9855 },
    serverDistanceMiles: 51,
  }),
  { ok: false, code: "distance_too_far" },
);

// Manipulated client distance / quote input is refused against server route.
assert.deepEqual(
  evaluateServerRoute({
    pickup: { lat: 40.7484, lng: -73.9857 },
    dropoff: { lat: 40.85, lng: -73.9 },
    serverDistanceMiles: 12,
    clientDistanceMiles: 1,
  }),
  { ok: false, code: "client_distance_mismatch" },
);

// Server route shorter than straight-line physics is impossible.
assert.deepEqual(
  evaluateServerRoute({
    pickup: { lat: 40.7, lng: -74 },
    dropoff: { lat: 41.2, lng: -74 },
    serverDistanceMiles: 1,
  }),
  { ok: false, code: "server_route_impossible" },
);

console.log("geoTrust tests passed");
