import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { canReviewDrivers } from "./adminAccess";
import {
  driverDecisionPush,
  driverDisabledEmail,
  driverRejectedEmail,
  driverReviewRequestedEmail,
  driverSuspendedEmail,
  DRIVER_HOME_URL,
} from "./driverReviewCopy";
import { driverAdminReviewUrl } from "./driverReviewNotifications";
import {
  PENDING_SIGNUP_ALERT_KEY,
  allowedSourceStatuses,
  applyReviewClaim,
  claimReviewTransition,
  decisionEventKey,
  forceOwnerInsertStatus,
  isDriverReviewerAccount,
  rejectionNoteError,
  resubmitAlertKey,
  sanitizeDriverDecisionNote,
  type ReviewStore,
} from "./driverReviewTransition";
import { driverApprovedEmail } from "./transactionalEmailTemplates";

const root = path.join(process.cwd(), "../..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261213120000_driver_review_lifecycle.sql"),
  "utf8",
);
const reviewRoute = fs.readFileSync(
  path.join(root, "apps/web/app/api/admin/drivers/review/route.ts"),
  "utf8",
);
const pendingRoute = fs.readFileSync(
  path.join(root, "apps/web/app/api/driver/pending-notice/route.ts"),
  "utf8",
);
const resubmitRoute = fs.readFileSync(
  path.join(root, "apps/web/app/api/driver/resubmit/route.ts"),
  "utf8",
);
const onboarding = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/DriverOnboardingScreen.tsx"),
  "utf8",
);
const locales = ["en", "fr", "es", "ar", "zh", "ff"] as const;

for (const status of ["approved", "rejected", "suspended", "disabled", "pending", ""]) {
  assert.equal(forceOwnerInsertStatus(status), "pending");
}

assert.match(migration, /new\.status := 'pending'/);
assert.match(migration, /new\.is_online := false/);
assert.match(migration, /new\.driver_decision_note := null/);
assert.match(migration, /guard_driver_profiles_self_insert/);
assert.match(migration, /mmd\.driver_resubmit/);
assert.match(migration, /old\.status = 'rejected'/);
assert.match(migration, /new\.status = 'pending'/);
assert.match(migration, /new\.status := old\.status/);
assert.match(migration, /driver_review_alerts/);
assert.match(migration, /driver_profiles/);
assert.match(migration, /supabase_realtime add table public\.driver_profiles/);
assert.match(migration, /resubmit_driver_application/);
assert.doesNotMatch(migration, /update public\.driver_profiles\s+set[\s\S]*status = 'approved'/);

assert.equal(claimReviewTransition("approved", "rejected").ok, false);
assert.equal(claimReviewTransition("rejected", "approved").ok, false);
assert.deepEqual(allowedSourceStatuses("rejected"), ["pending", "incomplete"]);
assert.ok(allowedSourceStatuses("approved").includes("suspended"));
assert.ok(allowedSourceStatuses("approved").includes("disabled"));
assert.deepEqual(allowedSourceStatuses("suspended"), ["approved"]);
assert.deepEqual(allowedSourceStatuses("disabled"), ["approved"]);

function fresh(): ReviewStore {
  return { status: "pending", notifications: [] };
}

const twoApproves = fresh();
const approveA = applyReviewClaim(twoApproves, "approved", "t1");
const approveB = applyReviewClaim(twoApproves, "approved", "t2");
assert.equal(approveA.ok, true);
assert.equal(approveA.notified, true);
assert.equal(approveB.ok, false);
assert.equal(approveB.error, "already_reviewed");
assert.equal(approveB.notified, false);
assert.equal(twoApproves.status, "approved");
assert.equal(twoApproves.notifications.length, 1);

const twoRejects = fresh();
const rejectA = applyReviewClaim(twoRejects, "rejected", "t1");
const rejectB = applyReviewClaim(twoRejects, "rejected", "t2");
assert.equal(rejectA.ok, true);
assert.equal(rejectB.ok, false);
assert.equal(rejectB.error, "already_reviewed");
assert.equal(twoRejects.status, "rejected");
assert.equal(twoRejects.notifications.length, 1);

const approveThenReject = fresh();
assert.equal(applyReviewClaim(approveThenReject, "approved", "t1").ok, true);
const crossed = applyReviewClaim(approveThenReject, "rejected", "t2");
assert.equal(crossed.ok, false);
assert.equal(crossed.error, "review_conflict");
assert.equal(approveThenReject.status, "approved");
assert.equal(approveThenReject.notifications.length, 1);

const rejectThenApprove = fresh();
assert.equal(applyReviewClaim(rejectThenApprove, "rejected", "t1").ok, true);
const crossedBack = applyReviewClaim(rejectThenApprove, "approved", "t2");
assert.equal(crossedBack.ok, false);
assert.equal(crossedBack.error, "review_conflict");
assert.equal(rejectThenApprove.status, "rejected");
assert.equal(rejectThenApprove.notifications.length, 1);

const afterRejected = { status: "rejected", notifications: [] };
assert.equal(applyReviewClaim(afterRejected, "approved", "t9").error, "review_conflict");
assert.equal(afterRejected.status, "rejected");
assert.equal(afterRejected.notifications.length, 0);

const afterApproved = { status: "approved", notifications: [] };
assert.equal(applyReviewClaim(afterApproved, "rejected", "t9").error, "review_conflict");
assert.equal(afterApproved.status, "approved");
assert.equal(afterApproved.notifications.length, 0);

assert.equal(rejectionNoteError("rejected", "no"), "rejection_reason_required");
assert.equal(rejectionNoteError("rejected", "License photo is unreadable"), null);
assert.equal(rejectionNoteError("approved", ""), null);
assert.equal(sanitizeDriverDecisionNote("<internal> ok"), "internal ok");
assert.ok(sanitizeDriverDecisionNote("x".repeat(800)).length <= 500);

const keyA = decisionEventKey({ from: "pending", to: "approved", reviewedAt: "t1" });
const keyB = decisionEventKey({ from: "pending", to: "approved", reviewedAt: "t1" });
assert.equal(keyA, keyB);
assert.notEqual(resubmitAlertKey("2026-01-01T00:00:00.000Z"), PENDING_SIGNUP_ALERT_KEY);

assert.equal(isDriverReviewerAccount("super_admin", false), true);
assert.equal(isDriverReviewerAccount("operations_admin", false), true);
assert.equal(isDriverReviewerAccount("review_admin", false), true);
assert.equal(isDriverReviewerAccount("finance_admin", false), false);
assert.equal(isDriverReviewerAccount("support_admin", false), false);
assert.equal(isDriverReviewerAccount("client", false), false);
assert.equal(isDriverReviewerAccount("restaurant", false), false);
assert.equal(isDriverReviewerAccount("seller", false), false);
assert.equal(isDriverReviewerAccount("driver", false), false);
assert.equal(isDriverReviewerAccount("client", true), true);
assert.equal(canReviewDrivers("finance_admin"), false);
assert.equal(canReviewDrivers("support_admin"), false);

assert.match(reviewRoute, /assertCanReviewDrivers/);
assert.match(reviewRoute, /\.in\("status"/);
assert.match(reviewRoute, /review_conflict/);
assert.match(reviewRoute, /claimReviewTransition/);
assert.match(reviewRoute, /rejectionNoteError/);
assert.match(reviewRoute, /notifyDriverStatusDecision/);
assert.doesNotMatch(reviewRoute, /notifyDriverApprovedEmail/);
const casAt = reviewRoute.indexOf('.in("status"');
const notifyAt = reviewRoute.lastIndexOf("notifyDriverStatusDecision");
assert.ok(casAt > 0 && notifyAt > casAt);

assert.match(pendingRoute, /awaiting:signup|PENDING_SIGNUP_ALERT_KEY|notifyReviewersOfPendingSignup/);
assert.match(pendingRoute, /role/);
assert.match(resubmitRoute, /resubmit_driver_application/);
assert.match(resubmitRoute, /driver_resubmitted/);
assert.match(resubmitRoute, /notifyReviewersOfResubmit/);
assert.doesNotMatch(resubmitRoute, /auth\.admin\.createUser/);

assert.equal(driverApprovedEmail({ locale: "en" }).ctaUrl, DRIVER_HOME_URL);
assert.equal(driverRejectedEmail({ locale: "fr", reason: "Photo floue" }).ctaUrl, DRIVER_HOME_URL);
assert.match(driverAdminReviewUrl("11111111-1111-4111-8111-111111111111") ?? "", /\/admin\/drivers\?q=/);
assert.equal(driverAdminReviewUrl("not-a-user"), null);

for (const locale of locales) {
  const rejected = driverRejectedEmail({ locale, reason: "Photo floue" });
  assert.match(rejected.headline + rejected.subject, /rejet|rechaz|رفض|拒绝|salaa|reject/i);
  assert.doesNotMatch(rejected.headline, /Approval pending|En attente d’approbation/i);
  assert.match(rejected.bodyHtml, /Photo floue/);
  assert.equal(driverSuspendedEmail({ locale }).ctaUrl, DRIVER_HOME_URL);
  assert.equal(driverDisabledEmail({ locale }).ctaUrl, DRIVER_HOME_URL);
  const review = driverReviewRequestedEmail({
    locale,
    driverName: "Awa",
    reviewUrl: "https://mmddelivery.com/admin/drivers?q=11111111-1111-4111-8111-111111111111",
  });
  assert.match(review.ctaUrl ?? "", /\/admin\/drivers\?q=/);
  assert.match(review.bodyHtml, /Awa/);
  const push = driverDecisionPush("rejected", locale, "Photo floue");
  assert.doesNotMatch(push.title, /Approval pending/i);
  assert.match(push.body, /Photo floue/);
  assert.doesNotMatch(JSON.stringify(push), /DriverTabs/);
}

const rejectedBranch = onboarding.indexOf('driverStatus === "rejected"');
const pendingAlert = onboarding.indexOf("driver.onboarding.pendingApprovalTitle");
assert.ok(rejectedBranch > 0 && pendingAlert > rejectedBranch);
assert.match(onboarding, /driver\.onboarding\.rejectedTitle/);
assert.match(onboarding, /driver\.onboarding\.rejectedReasonLabel/);
assert.match(onboarding, /resubmitDriverApplication/);
assert.doesNotMatch(onboarding, /review_notes/);

for (const locale of locales) {
  const extras = JSON.parse(
    fs.readFileSync(
      path.join(root, `apps/mobile/src/i18n/locales/${locale}/extras.json`),
      "utf8",
    ),
  ) as { driver: { onboarding: Record<string, string> } };
  const block = extras.driver.onboarding;
  for (const key of [
    "rejectedTitle",
    "rejectedBody",
    "rejectedReasonLabel",
    "rejectedNextStep",
    "resubmit",
    "resubmitDoneTitle",
    "resubmitDoneBody",
    "resubmitFailed",
  ]) {
    assert.equal(typeof block[key], "string", `${locale} ${key}`);
    assert.ok(block[key].trim().length > 0);
  }
  assert.doesNotMatch(block.rejectedTitle, /Approval pending/i);
}

const catalog = fs.readFileSync(
  path.join(root, "apps/web/src/i18n/adminUiCatalog.generated.ts"),
  "utf8",
);
for (const source of [
  "Approve",
  "Reject",
  "Suspend",
  "Disable",
  "Application rejected",
  "A rejection reason is required.",
  "Decision reason",
]) {
  assert.match(catalog, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

console.log("driverReviewLifecycle.regression.test.ts — PASS");
