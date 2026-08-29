import assert from "node:assert/strict";
import { searchPublicPlaces } from "./searchPublicPlaces";
import { canonicalizeClientAiRoute, sanitizeAssistantOutput, stripFakeMarkdownLinks } from "./aiActionSanitize";

function mockMapboxFetch(features: unknown[]) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    assert.match(url, /^https:\/\/api\.mapbox\.com\/geocoding\/v5\/mapbox\.places\//);
    assert.doesNotMatch(url, /MAPBOX_ACCESS_TOKEN/);
    return {
      ok: true,
      json: async () => ({ features }),
    } as Response;
  };
}

const hospitalFeature = {
  id: "poi.1",
  text: "City Hospital",
  place_name: "City Hospital, 1 Main St, Queens, NY",
  center: [-73.8, 40.72],
  place_type: ["poi"],
  context: [{ id: "place.1", text: "Queens" }],
  properties: { tel: "+1 555 0100" },
};

async function main() {
  const none = await searchPublicPlaces(
    { query: "hospital", nearest: true, locale: "fr" },
    { token: "pk.test", fetchFn: mockMapboxFetch([]) }
  );
  assert.equal(none.needsArea, true);
  assert.equal(none.invented, false);
  assert.equal(none.places.length, 0);
  assert.match(none.summary, /ville|quartier|adresse/i);

  const found = await searchPublicPlaces(
    { query: "hospital", nearest: true, latitude: 40.72, longitude: -73.8, locale: "en" },
    { token: "pk.test", fetchFn: mockMapboxFetch([hospitalFeature]) }
  );
  assert.equal(found.needsArea, false);
  assert.equal(found.ok, true);
  assert.equal(found.places.length, 1);
  assert.equal(found.places[0].name, "City Hospital");
  assert.equal(found.places[0].address, "City Hospital, 1 Main St, Queens, NY");
  assert.equal(found.places[0].city, "Queens");
  assert.equal(found.places[0].phone, "+1 555 0100");
  assert.equal(found.places[0].hours, null);
  assert.ok(found.places[0].distanceKm != null);
  assert.doesNotMatch(JSON.stringify(found.places), /access_token/);

  const named = await searchPublicPlaces(
    { query: "Bellevue Hospital", locale: "en" },
    { token: "pk.test", fetchFn: mockMapboxFetch([hospitalFeature]) }
  );
  assert.equal(named.needsArea, false);
  assert.equal(named.places[0].address.length > 0, true);

  const byArea = await searchPublicPlaces(
    { query: "mosque", area: "Dakar", nearest: true, locale: "fr" },
    {
      token: "pk.test",
      fetchFn: async (input) => {
        const url = String(input);
        if (url.includes("Dakar")) {
          return {
            ok: true,
            json: async () => ({
              features: [
                {
                  id: "place.dakar",
                  text: "Dakar",
                  place_name: "Dakar, Senegal",
                  center: [-17.44, 14.69],
                },
              ],
            }),
          } as Response;
        }
        return mockMapboxFetch([
          {
            id: "poi.mosque",
            text: "Grande Mosquée",
            place_name: "Grande Mosquée, Dakar",
            center: [-17.45, 14.69],
          },
        ])(input);
      },
    }
  );
  assert.equal(byArea.needsArea, false);
  assert.equal(byArea.places[0].name, "Grande Mosquée");

  const empty = await searchPublicPlaces(
    { query: "Bellevue Hospital Center", latitude: 40.7, longitude: -74, locale: "en" },
    { token: "pk.test", fetchFn: mockMapboxFetch([]) }
  );
  assert.equal(empty.places.length, 0);
  assert.match(empty.summary, /No reliable result/i);

  const noToken = await searchPublicPlaces(
    { query: "hospital", nearest: true, latitude: 40.7, longitude: -74 },
    { token: null, fetchFn: mockMapboxFetch([hospitalFeature]) }
  );
  assert.equal(noToken.ok, false);
  assert.equal(noToken.places.length, 0);
  assert.match(noToken.summary, /will not invent/i);

  const stripped = stripFakeMarkdownLinks(
    "Vous pouvez [Ouvrir l'application de taxi](#) pour continuer."
  );
  assert.equal(stripped.sawTaxiCta, true);
  assert.doesNotMatch(stripped.text, /\]\(#\)/);
  assert.match(stripped.text, /Ouvrir l'application de taxi/);

  const sanitized = sanitizeAssistantOutput(
    "Ouvrez [Ouvrir l'application de taxi](#).",
    [{ type: "navigate", label: "Open Taxi", route: "Taxi", params: {} }]
  );
  assert.equal(
    sanitized.actions.some((action) => action.type === "navigate" && action.route === "TaxiHome"),
    true
  );
  assert.doesNotMatch(sanitized.content, /\]\(#\)/);
  assert.equal(canonicalizeClientAiRoute("Taxi"), "TaxiHome");
  assert.equal(canonicalizeClientAiRoute("#"), null);
  assert.equal(canonicalizeClientAiRoute("javascript:void(0)"), null);

  console.log("searchPlaces.test.ts OK");
}

void main();
