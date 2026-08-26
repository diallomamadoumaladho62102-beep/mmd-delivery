import assert from "node:assert/strict";
import { resolveWalletLinkedJob } from "./walletLinkedJob";

const DR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const RIDE = "11111111-2222-4333-8444-555555555555";

assert.equal(resolveWalletLinkedJob({}), null);
assert.equal(
  resolveWalletLinkedJob({ reference_type: "delivery_request", reference_id: DR })
    ?.kind,
  "delivery_request",
);
assert.equal(
  resolveWalletLinkedJob({ reference_type: "taxi_ride", reference_id: RIDE })?.id,
  RIDE,
);
assert.equal(
  resolveWalletLinkedJob({
    entry_type: "ride_debit",
    description: `Trip payment ${RIDE}`,
  })?.kind,
  "taxi_ride",
);
assert.doesNotMatch(JSON.stringify(resolveWalletLinkedJob({ description: "Acme" })), /Acme/);

console.log("walletLinkedJob.test.ts OK");
