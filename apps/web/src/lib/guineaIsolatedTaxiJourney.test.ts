import assert from "node:assert/strict";
import {
  GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
  GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
  isolatedGuineaTaxiCreateFields,
  isGuineaIsolatedTaxiRide,
} from "./guineaIsolatedTaxiJourney";

assert.equal(GUINEA_ISOLATED_TEST_CLIENT_USER_ID, "9e0b3fb4-b23a-407c-a781-9f63f9b3de50");
assert.equal(GUINEA_ISOLATED_TEST_DRIVER_USER_ID, "05c34009-b050-454c-a94d-c4c803b26815");

const fields = isolatedGuineaTaxiCreateFields(GUINEA_ISOLATED_TEST_CLIENT_USER_ID);
assert.equal(fields.status, "accepted");
assert.equal(fields.is_test, true);
assert.equal(fields.hidden_from_user, true);
assert.equal(fields.driver_id, GUINEA_ISOLATED_TEST_DRIVER_USER_ID);
assert.equal(fields.preferred_driver_id, GUINEA_ISOLATED_TEST_DRIVER_USER_ID);

assert.throws(
  () => isolatedGuineaTaxiCreateFields("00000000-0000-4000-8000-000000000001"),
  /guinea_isolated_actor_required/,
);

assert.equal(
  isGuineaIsolatedTaxiRide({
    is_test: true,
    client_user_id: GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
    driver_id: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
  }),
  true,
);
assert.equal(
  isGuineaIsolatedTaxiRide({
    is_test: false,
    client_user_id: GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
    driver_id: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
  }),
  false,
);
assert.equal(
  isGuineaIsolatedTaxiRide({
    is_test: true,
    client_user_id: GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
    driver_id: "00000000-0000-4000-8000-000000000099",
  }),
  false,
);

console.log("guineaIsolatedTaxiJourney.test.ts OK");
