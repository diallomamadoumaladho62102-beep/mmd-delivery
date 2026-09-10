import assert from "node:assert/strict";
import {
  INCOMING_CALL_MIN_FETCH_GAP_MS,
  INCOMING_CALL_POLL_MS,
  callSessionsRealtimeFilter,
  createIncomingCallFetchGate,
  filterIncomingCallSessions,
  incomingCallSessionsEqual,
  isIncomingCallStatus,
  shouldFetchIncomingCallsOnAuthEvent,
  shouldWatchIncomingCalls,
} from "./incomingMaskedCallWatch";

assert.ok(INCOMING_CALL_POLL_MS >= 8_000, "poll must not hammer call_sessions");
assert.ok(INCOMING_CALL_MIN_FETCH_GAP_MS >= 2_000, "fetches must coalesce");
assert.ok(INCOMING_CALL_POLL_MS > INCOMING_CALL_MIN_FETCH_GAP_MS);

assert.equal(shouldFetchIncomingCallsOnAuthEvent("SIGNED_IN"), true);
assert.equal(shouldFetchIncomingCallsOnAuthEvent("SIGNED_OUT"), true);
assert.equal(shouldFetchIncomingCallsOnAuthEvent("TOKEN_REFRESHED"), false);
assert.equal(shouldFetchIncomingCallsOnAuthEvent("INITIAL_SESSION"), false);
assert.equal(shouldFetchIncomingCallsOnAuthEvent("USER_UPDATED"), false);
assert.equal(shouldFetchIncomingCallsOnAuthEvent("PASSWORD_RECOVERY"), false);

assert.equal(shouldWatchIncomingCalls("active"), true);
assert.equal(shouldWatchIncomingCalls("unknown"), true);
assert.equal(shouldWatchIncomingCalls("background"), false);
assert.equal(shouldWatchIncomingCalls("inactive"), false);

assert.equal(
  callSessionsRealtimeFilter("user-1"),
  "target_user_id=eq.user-1",
);

assert.equal(isIncomingCallStatus("ringing"), true);
assert.equal(isIncomingCallStatus("ended"), false);

const now = Date.parse("2026-09-10T12:00:00.000Z");
const incoming = filterIncomingCallSessions(
  [
    {
      id: "open",
      caller_role: "client",
      target_role: "driver",
      status: "ringing",
      order_id: "o1",
      expires_at: "2026-09-10T12:05:00.000Z",
    },
    {
      id: "expired",
      caller_role: "client",
      target_role: "driver",
      status: "ringing",
      order_id: "o2",
      expires_at: "2026-09-10T11:59:00.000Z",
    },
    {
      id: "done",
      caller_role: "client",
      target_role: "driver",
      status: "ringing",
      order_id: "o3",
      ended_at: "2026-09-10T11:58:00.000Z",
    },
  ],
  now,
);
assert.deepEqual(
  incoming.map((row) => row.id),
  ["open"],
);

assert.equal(
  incomingCallSessionsEqual(incoming, incoming),
  true,
);
assert.equal(
  incomingCallSessionsEqual(incoming, [
    { ...incoming[0], status: "active" },
  ]),
  false,
);

async function testFetchGate() {
  let clock = 10_000;
  const calls: string[] = [];
  const gate = createIncomingCallFetchGate({
    minGapMs: 3_000,
    now: () => clock,
  });

  await gate.run(async () => {
    calls.push("a");
    await Promise.resolve();
  });
  await gate.run(async () => {
    calls.push("b");
  });
  assert.deepEqual(calls, ["a"], "second fetch within min gap is coalesced");
  assert.equal(gate.pending, true);
  gate.dispose();

  const slow = createIncomingCallFetchGate({
    minGapMs: 3_000,
    now: () => clock,
  });
  let release!: () => void;
  const first = slow.run(
    () =>
      new Promise<void>((resolve) => {
        calls.push("in-flight");
        release = resolve;
      }),
  );
  const overlapped = slow.run(async () => {
    calls.push("trailing");
  });
  assert.equal(slow.inFlight, true);
  release();
  await first;
  await overlapped;
  assert.ok(calls.includes("in-flight"));
  assert.ok(calls.includes("trailing"), "a fetch that arrives in-flight must run after");

  clock += 4_000;
  await gate.run(async () => {
    calls.push("after-gap");
  });
  assert.ok(calls.includes("after-gap"));
}

void testFetchGate()
  .then(() => {
    console.log("incomingMaskedCallWatch.test.ts OK");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
