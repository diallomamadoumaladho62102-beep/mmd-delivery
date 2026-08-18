import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAbandonedStaleAssignedJob,
  suggestedAdminActionForStaleJob,
  staleJobAgeHours,
} from "./adminStaleDriverJobs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

test("abandoned stale: ready/dispatched >48h flagged; mid-mission not", () => {
  const now = Date.parse("2026-08-17T20:00:00.000Z");
  const stale = "2026-08-03T06:30:00.000Z";
  assert.equal(
    isAbandonedStaleAssignedJob({ status: "ready", updated_at: stale }, now),
    true,
  );
  assert.equal(
    isAbandonedStaleAssignedJob(
      { status: "dispatched", updated_at: stale },
      now,
    ),
    true,
  );
  assert.equal(
    isAbandonedStaleAssignedJob(
      { status: "picked_up", updated_at: stale },
      now,
    ),
    false,
  );
  assert.equal(
    isAbandonedStaleAssignedJob(
      { status: "in_progress", updated_at: stale },
      now,
    ),
    false,
  );
  assert.equal(
    isAbandonedStaleAssignedJob(
      { status: "delivered", updated_at: stale },
      now,
    ),
    false,
  );
});

test("suggested admin action for stuck ready/dispatched", () => {
  assert.equal(
    suggestedAdminActionForStaleJob("ready"),
    "review_then_cancel_or_force_complete",
  );
  assert.equal(
    suggestedAdminActionForStaleJob("dispatched"),
    "review_then_cancel_or_force_complete",
  );
  assert.equal(
    suggestedAdminActionForStaleJob("picked_up"),
    "force_complete_or_investigate",
  );
});

test("stale age hours positive for Aug 3 jobs", () => {
  const hours = staleJobAgeHours(
    { updated_at: "2026-08-03T06:30:00.000Z" },
    Date.parse("2026-08-17T20:00:00.000Z"),
  );
  assert.ok(hours != null && hours > 48);
});

test("admin stale-driver-jobs API is read-only GET", () => {
  const route = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/app/api/admin/ops/stale-driver-jobs/route.ts",
    ),
    "utf8",
  );
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /\.update\(/);
  assert.doesNotMatch(route, /status:\s*["']completed["']/);
  assert.match(route, /assertCanManageOrders/);
});

test("Link py_ charge ids accepted as Transfer source_transaction", () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      "apps/web/src/lib/finance/executeTaxiDriverFareTransfer.ts",
    ),
    "utf8",
  );
  assert.match(src, /resolveSourceChargeIdFromPaymentIntent/);
  assert.match(src, /startsWith\("ch_"\) \|\| id\.startsWith\("py_"\)/);
  assert.match(src, /expand:\s*\[["']latest_charge["']\]/);
});

console.log("adminStaleDriverJobs + py_ source charge regression passed");
