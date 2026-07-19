import assert from "node:assert/strict";

/**
 * Pure helpers mirroring the production fallback used when accept timestamp
 * columns are missing (PostgREST 42703).
 */
function buildAcceptUpdatePayload(nowIso: string, opts?: {
  estimatedPrepMinutes?: number | null;
  markAutoAccepted?: boolean;
}) {
  const payload: Record<string, unknown> = {
    status: "accepted",
    updated_at: nowIso,
    restaurant_accepted_at: nowIso,
    accepted_at: nowIso,
  };
  if (opts?.estimatedPrepMinutes != null && opts.estimatedPrepMinutes > 0) {
    payload.estimated_prep_minutes = opts.estimatedPrepMinutes;
  }
  if (opts?.markAutoAccepted) payload.auto_accepted = true;
  return payload;
}

function buildAcceptFallbackPayload(
  nowIso: string,
  markAutoAccepted = false,
): Record<string, unknown> {
  const fallback: Record<string, unknown> = {
    status: "accepted",
    updated_at: nowIso,
  };
  if (markAutoAccepted) fallback.auto_accepted = true;
  return fallback;
}

function isMissingColumnError(message: string) {
  return /42703|column .* does not exist/i.test(message);
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("accept payload includes kitchen timestamps when schema supports them", () => {
  const payload = buildAcceptUpdatePayload("2026-07-19T20:00:00.000Z");
  assert.equal(payload.status, "accepted");
  assert.equal(payload.accepted_at, "2026-07-19T20:00:00.000Z");
  assert.equal(payload.restaurant_accepted_at, "2026-07-19T20:00:00.000Z");
});

test("fallback accept payload omits missing timestamp columns", () => {
  const fallback = buildAcceptFallbackPayload("2026-07-19T20:00:00.000Z", false);
  assert.equal(fallback.status, "accepted");
  assert.equal("accepted_at" in fallback, false);
  assert.equal("restaurant_accepted_at" in fallback, false);
});

test("detects PostgREST missing-column errors for retry", () => {
  assert.equal(
    isMissingColumnError(
      'column "restaurant_accepted_at" of relation "orders" does not exist',
    ),
    true,
  );
  assert.equal(isMissingColumnError("42703"), true);
  assert.equal(isMissingColumnError("permission denied"), false);
});

console.log("restaurantOrderStatusService.test.ts: all passed");
