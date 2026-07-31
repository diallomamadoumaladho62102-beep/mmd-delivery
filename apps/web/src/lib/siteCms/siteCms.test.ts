import test from "node:test";
import assert from "node:assert/strict";
import { isPublishedNow, BLOCK_TYPES } from "@/lib/siteCms";

test("isPublishedNow rejects draft and future schedules", () => {
  assert.equal(isPublishedNow({ status: "draft" }), false);
  assert.equal(isPublishedNow({ status: "archived" }), false);
  assert.equal(
    isPublishedNow({
      status: "published",
      published_at: new Date(Date.now() + 60_000).toISOString(),
    }),
    false,
  );
  assert.equal(
    isPublishedNow({
      status: "published",
      published_at: new Date(Date.now() - 60_000).toISOString(),
    }),
    true,
  );
});

test("block types include hero and services", () => {
  assert.ok(BLOCK_TYPES.includes("hero"));
  assert.ok(BLOCK_TYPES.includes("services"));
  assert.ok(BLOCK_TYPES.includes("faq"));
});
