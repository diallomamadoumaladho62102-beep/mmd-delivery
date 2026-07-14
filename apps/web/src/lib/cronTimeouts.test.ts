import assert from "node:assert/strict";
import {
  CronTimeoutError,
  readCronBatchLimit,
  remainingBudgetMs,
  withTimeout,
} from "./cronTimeouts";

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((error) => {
      console.error(`fail - ${name}`);
      throw error;
    });
}

async function main() {
  await test("withTimeout resolves fast promises", async () => {
    const value = await withTimeout(Promise.resolve(42), 1000, "supabase_timeout");
    assert.equal(value, 42);
  });

  await test("withTimeout rejects as CronTimeoutError", async () => {
    await assert.rejects(
      () =>
        withTimeout(
          new Promise((resolve) => setTimeout(resolve, 50)),
          5,
          "lock_timeout"
        ),
      (error: unknown) =>
        error instanceof CronTimeoutError && error.code === "lock_timeout"
    );
  });

  await test("readCronBatchLimit defaults to 1 and parses query", () => {
    assert.equal(readCronBatchLimit(new URLSearchParams(""), 1), 1);
    assert.equal(readCronBatchLimit(new URLSearchParams("limit=5"), 1), 5);
    assert.equal(readCronBatchLimit(new URLSearchParams("limit=0"), 1), 0);
  });

  await test("remainingBudgetMs decreases", async () => {
    const started = Date.now() - 10_000;
    assert.ok(remainingBudgetMs(started, 45_000) < 45_000);
  });

  console.log("cronTimeouts tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
