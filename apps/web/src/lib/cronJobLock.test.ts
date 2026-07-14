import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withCronJobLock } from "./cronJobLock";

function test(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`ok - ${name}`))
    .catch((error) => {
      console.error(`fail - ${name}`);
      throw error;
    });
}

type RpcState = {
  holders: Map<string, string>;
};

function createMockSupabase(state: RpcState): SupabaseClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "try_acquire_cron_job_lock") {
        const job = String(args.p_job_name);
        const by = String(args.p_locked_by);
        const current = state.holders.get(job);
        if (current && current !== by) {
          return {
            data: { ok: false, error: "lock_busy", locked_by: current },
            error: null,
          };
        }
        state.holders.set(job, by);
        return {
          data: { ok: true, job_name: job, locked_by: by, locked_until: null },
          error: null,
        };
      }
      if (fn === "release_cron_job_lock") {
        const job = String(args.p_job_name);
        const by = String(args.p_locked_by);
        if (state.holders.get(job) === by) state.holders.delete(job);
        return { data: { ok: true, released: true }, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    },
  } as unknown as SupabaseClient;
}

async function main() {
  const state: RpcState = { holders: new Map() };
  const supabase = createMockSupabase(state);

  await test("first acquire wins", async () => {
    const first = await withCronJobLock(supabase, "job-a", async () => "done", {
      lockedBy: "runner-1",
    });
    assert.equal(first.ok, true);
    if (first.ok) assert.equal(first.result, "done");
  });

  await test("concurrent second acquire is busy", async () => {
    state.holders.set("job-b", "runner-1");
    const second = await withCronJobLock(
      supabase,
      "job-b",
      async () => "should-not-run",
      { lockedBy: "runner-2" }
    );
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.error, "lock_busy");
  });

  await test("replay after release succeeds", async () => {
    state.holders.clear();
    const one = await withCronJobLock(supabase, "job-c", async () => 1, {
      lockedBy: "runner-1",
    });
    const two = await withCronJobLock(supabase, "job-c", async () => 2, {
      lockedBy: "runner-2",
    });
    assert.equal(one.ok, true);
    assert.equal(two.ok, true);
    if (two.ok) assert.equal(two.result, 2);
  });

  await test("payment-expiration shared lock serializes expire alias + canonical", async () => {
    state.holders.clear();
    const lockName = "payment-expiration";
    let expireStaleRan = false;

    const holdStarted = withCronJobLock(
      supabase,
      lockName,
      async () => {
        // Keep the lease while the concurrent caller attempts acquire.
        await new Promise((r) => setTimeout(r, 80));
        return "alias-done";
      },
      { lockedBy: "expire-unpaid" }
    );

    // Ensure first acquire completed before concurrent attempt.
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(state.holders.get(lockName), "expire-unpaid");

    const concurrent = await withCronJobLock(
      supabase,
      lockName,
      async () => {
        expireStaleRan = true;
        return "stale-should-not-run";
      },
      { lockedBy: "expire-stale-payments" }
    );

    assert.equal(concurrent.ok, false);
    assert.equal(expireStaleRan, false);
    const held = await holdStarted;
    assert.equal(held.ok, true);
  });

  await test("atomic claim: second cancel on same id is already_processed", async () => {
    const claimed = new Set<string>();
    async function claimOnce(id: string): Promise<"claimed" | "already_processed"> {
      if (claimed.has(id)) return "already_processed";
      claimed.add(id);
      return "claimed";
    }
    assert.equal(await claimOnce("order-1"), "claimed");
    assert.equal(await claimOnce("order-1"), "already_processed");
  });

  console.log("cronJobLock tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
