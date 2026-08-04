import assert from "node:assert/strict";
import {
  isClientProfileComplete,
  scoreClientProfileCompleteness,
} from "./profileCompleteness";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("incomplete empty profile scores 0", () => {
  const score = scoreClientProfileCompleteness({});
  assert.equal(score.percent, 0);
  assert.equal(score.status, "incomplete");
  assert.ok(score.missing.includes("email"));
});

test("full verified profile scores 100", () => {
  const score = scoreClientProfileCompleteness({
    firstName: "Aïcha",
    lastName: "Diallo",
    email: "aicha@example.com",
    emailVerified: true,
    phone: "+224620000000",
    phoneVerified: true,
    avatarUrl: "https://example.com/a.jpg",
    addressLine: "Conakry Centre",
    city: "Conakry",
    latitude: 9.5,
    longitude: -13.7,
  });
  assert.equal(score.percent, 100);
  assert.equal(score.status, "complete");
  assert.deepEqual(score.missing, []);
});

test("soft complete without verified flags for legacy users", () => {
  assert.equal(
    isClientProfileComplete({
      fullName: "Fatou Bah",
      phone: "620000000",
      addressLine: "Kaloum",
      avatarUrl: "https://example.com/f.jpg",
    }),
    true,
  );
});

console.log("profileCompleteness tests passed");
