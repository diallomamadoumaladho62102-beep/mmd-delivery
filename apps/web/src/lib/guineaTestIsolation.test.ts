import assert from "node:assert/strict";
import {
  GUINEA_ISOLATED_TEST_USER_IDS,
  GUINEA_TEST_LIVE_OPERATION_BLOCKED,
  US_ISOLATED_TEST_EMAILS,
  US_ISOLATED_TEST_USER_IDS,
  US_TEST_LIVE_OPERATION_BLOCKED,
  guineaIsolatedTestUserInvolved,
  isGuineaIsolatedTestEmail,
  isGuineaIsolatedTestUserId,
  isIsolatedCertTestEmail,
  isIsolatedFromLiveDispatch,
  isUsIsolatedTestEmail,
  isUsIsolatedTestUserId,
} from "./guineaTestIsolation";

assert.equal(isGuineaIsolatedTestEmail("guinea-client@example.com"), true);
assert.equal(isGuineaIsolatedTestEmail("  Guinea-Driver@Example.com "), true);
assert.equal(isGuineaIsolatedTestEmail("guinea-restaurant@example.com"), true);
assert.equal(isGuineaIsolatedTestEmail("guinea-seller@example.com"), true);
assert.equal(isGuineaIsolatedTestEmail("client@example.com"), false);
assert.equal(isGuineaIsolatedTestEmail("guinea-client@example.com.evil"), false);
assert.equal(isGuineaIsolatedTestEmail(""), false);
assert.equal(isUsIsolatedTestEmail("us-cert-driver@example.com"), true);
assert.equal(isUsIsolatedTestEmail("us-cert-restaurant@example.com"), true);
assert.equal(isUsIsolatedTestEmail("us-cert-seller@example.com"), true);
assert.equal(isUsIsolatedTestEmail("us-cert-driver@example.com.evil"), false);
assert.equal(isIsolatedCertTestEmail("us-cert-seller@example.com"), true);
assert.equal(US_ISOLATED_TEST_EMAILS.length, 3);
assert.equal(US_ISOLATED_TEST_USER_IDS.length, 3);
assert.equal(isUsIsolatedTestUserId("78bfe637-6cb9-46de-8d59-17e4b7720436"), true);
assert.equal(isUsIsolatedTestUserId("37004c8c-52c9-47de-91b6-86f26288ece6"), true);
assert.equal(isUsIsolatedTestUserId("c0720d55-083d-4c61-a05d-e38700fc49cf"), true);
assert.equal(
  isIsolatedFromLiveDispatch({
    client_user_id: "78bfe637-6cb9-46de-8d59-17e4b7720436",
  }),
  true,
);
assert.equal(GUINEA_TEST_LIVE_OPERATION_BLOCKED, "guinea_test_live_operation_blocked");
assert.equal(US_TEST_LIVE_OPERATION_BLOCKED, "us_test_live_operation_blocked");
assert.equal(GUINEA_ISOLATED_TEST_USER_IDS.length, 4);
assert.equal(isGuineaIsolatedTestUserId("9e0b3fb4-b23a-407c-a781-9f63f9b3de50"), true);
assert.equal(isGuineaIsolatedTestUserId("05c34009-b050-454c-a94d-c4c803b26815"), true);
assert.equal(isGuineaIsolatedTestUserId("2c1dc7b3-3784-4f35-ba72-56d6b3cd16fe"), true);
assert.equal(isGuineaIsolatedTestUserId("7f1e2105-4032-4d49-868d-a7e2dad710a1"), true);
assert.equal(isGuineaIsolatedTestUserId("00000000-0000-4000-8000-000000000001"), false);
assert.equal(
  isIsolatedFromLiveDispatch({
    client_user_id: "9e0b3fb4-b23a-407c-a781-9f63f9b3de50",
  }),
  true,
);
assert.equal(isIsolatedFromLiveDispatch({ is_test: true, client_user_id: "00000000-0000-4000-8000-000000000001" }), true);
assert.equal(isIsolatedFromLiveDispatch({ hidden_from_user: true }), true);
assert.equal(isIsolatedFromLiveDispatch({ archived_at: "2026-10-19T00:00:00.000Z" }), true);
assert.equal(
  isIsolatedFromLiveDispatch({
    client_user_id: "00000000-0000-4000-8000-000000000001",
    is_test: false,
    hidden_from_user: false,
    archived_at: null,
  }),
  false,
);

async function assertLookup() {
const adminDown = {
  auth: {
    admin: {
      getUserById: async () => {
        throw new Error("admin_down");
      },
    },
  },
};
assert.equal(
  await guineaIsolatedTestUserInvolved(adminDown, ["9e0b3fb4-b23a-407c-a781-9f63f9b3de50"]),
  true,
);
assert.equal(
  await guineaIsolatedTestUserInvolved(adminDown, ["00000000-0000-4000-8000-000000000001"]),
  false,
);
assert.equal(
  await guineaIsolatedTestUserInvolved(
    {
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "guinea-seller@example.com" } },
            error: null,
          }),
        },
      },
    },
    ["11111111-1111-4111-8111-111111111111"],
  ),
  true,
);
assert.equal(
  await guineaIsolatedTestUserInvolved(
    {
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "us-cert-driver@example.com" } },
            error: null,
          }),
        },
      },
    },
    ["22222222-2222-4222-8222-222222222222"],
  ),
  true,
);

console.log("guineaTestIsolation.test.ts OK");
}

assertLookup().catch((error) => {
  console.error(error);
  process.exit(1);
});
