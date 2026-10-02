import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDisputeReasonCode, DRIVER_DISPUTE_REASON_CODES } from "./disputeReasons";
import { parseWaitReasonCode } from "./waitReasons";
import { DRIVER_INTEGRITY_ENTITY_TYPES, DRIVER_WAIT_REASON_CODES } from "./types";
import { driverOwnsAssignment } from "./assignmentOwnership";
import { evaluateReassignmentEligibility } from "./reassignmentPolicy";
import { DEFAULT_DRIVER_INTEGRITY_SETTINGS } from "./types";
import { voiceContactNeverExposesDriverPhone } from "./voiceContact";
import { failClosedScanSkipReason } from "./engineGate";
import {
  DRIVER_INTEGRITY_CRON_EXPRESSION,
  DRIVER_INTEGRITY_LOCK_TTL_SECONDS,
  isSupportedGithubActionsSchedule,
  lockTtlFitsSchedule,
} from "./schedulerCadence";

const webRoot = process.cwd();
const hardening = readFileSync(
  join(webRoot, "../../supabase/migrations/20261207120000_pre_shadow_hardening.sql"),
  "utf8"
);
const scan = readFileSync(join(webRoot, "src/lib/driverIntegrity/scan.ts"), "utf8");
const waitApi = readFileSync(join(webRoot, "app/api/driver/integrity/wait-reason/route.ts"), "utf8");
const disputeApi = readFileSync(join(webRoot, "app/api/driver/integrity/dispute/route.ts"), "utf8");
const contactApi = readFileSync(
  join(webRoot, "app/api/admin/driver-integrity/contact/route.ts"),
  "utf8"
);
const marketplace = readFileSync(
  join(webRoot, "src/lib/marketplaceDriverJobsService.ts"),
  "utf8"
);
const cronYml = readFileSync(
  join(webRoot, "../../.github/workflows/production-driver-integrity-cron.yml"),
  "utf8"
);
const dispatchYml = readFileSync(
  join(webRoot, "../../.github/workflows/production-dispatch-crons.yml"),
  "utf8"
);
const dispatchScript = readFileSync(
  join(webRoot, "../../scripts/run-production-dispatch-crons.mjs"),
  "utf8"
);
const mobilePanel = readFileSync(
  join(webRoot, "../mobile/src/components/driver/DriverIntegrityReportPanel.tsx"),
  "utf8"
);
const extrasEn = readFileSync(
  join(webRoot, "../mobile/src/i18n/locales/en/extras.json"),
  "utf8"
);
const extrasLocales = ["en", "fr", "es", "ar", "zh", "ff"] as const;

test("entity types include marketplace_job", () => {
  assert.deepEqual([...DRIVER_INTEGRITY_ENTITY_TYPES], [
    "order",
    "delivery_request",
    "marketplace_job",
  ]);
});

test("wait and dispute catalogs are the server source of truth", () => {
  assert.equal(DRIVER_WAIT_REASON_CODES.length, 8);
  assert.equal(DRIVER_DISPUTE_REASON_CODES.length, 5);
  assert.equal(parseWaitReasonCode("restaurant_delay"), "restaurant_delay");
  assert.equal(parseWaitReasonCode("forged"), null);
  assert.equal(parseDisputeReasonCode("restaurant"), "restaurant");
  assert.equal(parseDisputeReasonCode("gps_issue"), "gps");
  assert.equal(parseDisputeReasonCode("forged"), null);
});

test("IDOR: another driver does not own the assignment", () => {
  assert.equal(
    driverOwnsAssignment(
      {
        id: "e1",
        driverId: "driver-a",
        driverAcceptedAt: "2026-01-01T00:00:00Z",
        status: "dispatched",
        pickedUp: false,
        delivered: false,
        cancelled: false,
      },
      "driver-b"
    ),
    false
  );
});

test("wait/dispute APIs never accept client timestamps", () => {
  assert.doesNotMatch(waitApi, /accepted_at\s*=/);
  assert.doesNotMatch(waitApi, /body\.accepted_at/);
  assert.doesNotMatch(disputeApi, /body\.delivered_at/);
  assert.match(waitApi, /timestamps_unchanged/);
  assert.match(disputeApi, /earnings_unchanged/);
  assert.match(waitApi, /not_assigned/);
  assert.match(disputeApi, /forbidden/);
  assert.match(disputeApi, /already_submitted/);
  assert.match(disputeApi, /incident_closed/);
});

test("marketplace reassignment is atomic and excludes previous driver", () => {
  assert.match(hardening, /driver_integrity_reassign_marketplace_job/);
  assert.match(hardening, /for update/);
  assert.match(hardening, /already_reassigned/);
  assert.match(hardening, /driver_integrity_reassignment_exclusions/);
  assert.match(hardening, /status = 'dispatch_ready'/);
  assert.doesNotMatch(hardening, /driver_accepted_at\s*=\s*null/);
  assert.match(scan, /driver_integrity_reassign_marketplace_job/);
  assert.match(scan, /marketplace_delivery_jobs/);
  assert.match(marketplace, /driver_excluded/);
  assert.match(marketplace, /excludedIds/);
});

test("trip_time_intervals are per assignment attempt", () => {
  assert.match(hardening, /assignment_seq/);
  assert.match(hardening, /trip_time_intervals_attempt_uq/);
  assert.match(hardening, /trip_time_intervals_open_entity_uq/);
  assert.match(hardening, /end_reason.*reassigned/);
  assert.match(hardening, /minimum_pay_close_open_trip_interval/);
  assert.match(hardening, /started_at is never rewritten/);
  assert.doesNotMatch(hardening, /update public\.trip_time_intervals[\s\S]*started_at\s*=/);
});

test("scheduler uses GitHub-supported 5-minute cadence, not an unsupported 2-minute tick", () => {
  assert.equal(DRIVER_INTEGRITY_CRON_EXPRESSION, "*/5 * * * *");
  assert.equal(isSupportedGithubActionsSchedule("*/2 * * * *"), false);
  assert.equal(isSupportedGithubActionsSchedule("*/5 * * * *"), true);
  assert.ok(lockTtlFitsSchedule(DRIVER_INTEGRITY_LOCK_TTL_SECONDS));
  assert.match(cronYml, /\*\/5 \* \* \* \*/);
  assert.doesNotMatch(cronYml, /\*\/2 \* \* \* \*/);
  assert.match(cronYml, /production-driver-integrity-cron/);
  assert.doesNotMatch(dispatchScript, /\/api\/cron\/driver-integrity/);
  assert.match(dispatchYml, /\*\/10 \* \* \* \*/);
  assert.match(scan, /acquireCronJobLock/);
  assert.match(scan, /DRIVER_INTEGRITY_LOCK_TTL_SECONDS/);
  assert.match(scan, /failClosedScanSkipReason/);
  assert.doesNotMatch(scan, /ttlSeconds:\s*120/);
});

test("flags remain fail-closed in default settings and scan", () => {
  const skip = failClosedScanSkipReason(DEFAULT_DRIVER_INTEGRITY_SETTINGS);
  assert.ok(skip);
});

test("voice contact never exposes driver phone", () => {
  assert.equal(voiceContactNeverExposesDriverPhone(), true);
  assert.match(contactApi, /driver_phone_exposed: false/);
  assert.match(contactApi, /channel === "voice"/);
  assert.match(contactApi, /assertStaffPermission\("driver_integrity.manage"/);
  assert.match(contactApi, /assertStaffPermission\("driver_integrity.read"/);
  assert.doesNotMatch(contactApi, /target_phone/);
  assert.doesNotMatch(contactApi, /caller_phone/);
});

test("mobile wait/dispute UI is wired", () => {
  assert.match(mobilePanel, /submitWaitReason/);
  assert.match(mobilePanel, /submitDispute/);
  assert.match(mobilePanel, /alreadySubmittedTitle/);
  assert.match(extrasEn, /"integrity"/);
  for (const locale of extrasLocales) {
    const extras = JSON.parse(
      readFileSync(
        join(webRoot, `../mobile/src/i18n/locales/${locale}/extras.json`),
        "utf8"
      )
    ) as { driver?: { integrity?: { wait?: Record<string, string>; dispute?: Record<string, string> } } };
    const integrity = extras.driver?.integrity;
    assert.ok(integrity, locale);
    for (const code of DRIVER_WAIT_REASON_CODES) {
      assert.ok(integrity.wait?.[code], `${locale}/${code}`);
    }
    for (const code of DRIVER_DISPUTE_REASON_CODES) {
      assert.ok(integrity.dispute?.[code], `${locale}/dispute/${code}`);
    }
  }
});

test("concurrent reassignment is blocked when already reassigned or picked up", () => {
  const base = {
    settings: {
      ...DEFAULT_DRIVER_INTEGRITY_SETTINGS,
      monitoringEnabled: true,
      reassignmentEnabled: true,
      driverNoProgressReassignmentAfterSeconds: 60,
    },
    signals: {
      driverAcceptedAtMs: Date.parse("2026-01-01T00:00:00Z"),
      nowMs: Date.parse("2026-01-01T00:05:00Z"),
      arrivedAtMs: null,
      waitTimerStartedAtMs: null,
      pickedUpAtMs: null,
      deliveredAtMs: null,
      cancelledAtMs: null,
      locationUpdatedAtMs: null,
      metersFromAccept: 0,
      gpsAvailable: true,
      gpsStale: false,
      waitReasonCode: null,
    },
    assignment: {
      entityType: "marketplace_job" as const,
      entityId: "job-1",
      driverId: "driver-a",
      status: "dispatch_assigned",
      driverAcceptedAt: "2026-01-01T00:00:00Z",
      pickedUpAt: null,
      deliveredAt: null,
      cancelledAt: null,
      alreadyReassigned: false,
    },
    expectedDriverId: "driver-a",
    firstWarningAtMs: Date.parse("2026-01-01T00:02:00Z"),
  };
  assert.equal(evaluateReassignmentEligibility(base).ok, true);
  assert.equal(
    evaluateReassignmentEligibility({
      ...base,
      assignment: { ...base.assignment, alreadyReassigned: true },
    }).ok,
    false
  );
  assert.equal(
    evaluateReassignmentEligibility({
      ...base,
      assignment: { ...base.assignment, driverId: "driver-b" },
    }).ok,
    false
  );
});
