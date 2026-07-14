import assert from "node:assert/strict";
import { parseMapboxPlaceSuggestions } from "./mapboxPlacesParse";

function testEmptyAndInvalid() {
  assert.deepEqual(parseMapboxPlaceSuggestions(null), []);
  assert.deepEqual(parseMapboxPlaceSuggestions(undefined), []);
  assert.deepEqual(parseMapboxPlaceSuggestions([]), []);
  assert.deepEqual(parseMapboxPlaceSuggestions([{}]), []);
}

function testParsing() {
  const suggestions = parseMapboxPlaceSuggestions([
    {
      id: "poi.1",
      name: "Cafe",
      fullAddress: "123 Main St, Brooklyn",
      latitude: 40.7,
      longitude: -73.9,
      placeType: "poi",
    },
    {
      id: "bad",
      name: "Nope",
      fullAddress: "x",
      latitude: "NaN",
      longitude: -73.9,
    },
  ]);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].name, "Cafe");
  assert.equal(suggestions[0].placeType, "poi");
}

function testNameFallback() {
  const suggestions = parseMapboxPlaceSuggestions([
    {
      id: "1",
      fullAddress: "Only Address",
      latitude: 1,
      longitude: 2,
    },
  ]);
  assert.equal(suggestions[0].name, "Only Address");
  assert.equal(suggestions[0].fullAddress, "Only Address");
}

testEmptyAndInvalid();
testParsing();
testNameFallback();

console.log("mapboxPlaces.test.ts OK");
