import assert from "node:assert/strict";
import {
  isolatedGuineaDeliveryCreateFields,
  isGuineaIsolatedDelivery,
} from "./guineaIsolatedDeliveryJourney";
import {
  GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
  GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
} from "./guineaIsolatedTaxiJourney";

const fields = isolatedGuineaDeliveryCreateFields(GUINEA_ISOLATED_TEST_CLIENT_USER_ID);
assert.equal(fields.is_test, true);
assert.equal(fields.hidden_from_user, true);
assert.equal(fields.driver_id, GUINEA_ISOLATED_TEST_DRIVER_USER_ID);
assert.equal(fields.status, "accepted");

assert.equal(
  isGuineaIsolatedDelivery({
    is_test: true,
    client_user_id: GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
    driver_id: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
  }),
  true,
);

assert.equal(
  isGuineaIsolatedDelivery({
    is_test: false,
    client_user_id: GUINEA_ISOLATED_TEST_CLIENT_USER_ID,
    driver_id: GUINEA_ISOLATED_TEST_DRIVER_USER_ID,
  }),
  false,
);

assert.throws(
  () => isolatedGuineaDeliveryCreateFields("00000000-0000-0000-0000-000000000099"),
  /guinea_isolated_actor_required/,
);

console.log("guineaIsolatedDeliveryJourney.test.ts OK");
