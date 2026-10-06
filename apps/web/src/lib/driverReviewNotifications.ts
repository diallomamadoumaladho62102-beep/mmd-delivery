import type { SupabaseClient } from "@supabase/supabase-js";
import { isAccountActive } from "./accountStatus";
import { notifyDriverAccountDecisionPush } from "./driverPushNotifications";
import {
  DRIVER_HOME_URL,
  driverDecisionPush,
  driverDisabledEmail,
  driverRejectedEmail,
  driverReviewRequestedEmail,
  driverSuspendedEmail,
} from "./driverReviewCopy";
import {
  PENDING_SIGNUP_ALERT_KEY,
  decisionEventKey,
  decisionNoteForStatus,
  isDriverReviewerAccount,
  resubmitAlertKey,
  type DriverReviewTarget,
} from "./driverReviewTransition";
import {
  driverApprovedEmail,
  renderTransactionalEmailHtml,
  renderTransactionalEmailText,
} from "./transactionalEmailTemplates";
import {
  sendTransactionalTemplateEmail,
} from "./transactionalEmails";
import { notifyUserTransactional } from "./transactionalOutbound";
import { loadPreferredLocale } from "./userLocale";

const ADMIN_REVIEW_ORIGIN = "https://mmddelivery.com";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function driverAdminReviewUrl(userId: string): string | null {
  if (!UUID_RE.test(userId)) return null;
  return `${ADMIN_REVIEW_ORIGIN}/admin/drivers?q=${encodeURIComponent(userId)}`;
}

export function driverHomeUrl(): string {
  return DRIVER_HOME_URL;
}

type ClaimResult = "claimed" | "duplicate" | "unavailable";

export async function claimDriverReviewAlert(
  supabaseAdmin: SupabaseClient,
  driverUserId: string,
  eventKey: string,
): Promise<ClaimResult> {
  const { error } = await supabaseAdmin.from("driver_review_alerts").insert({
    driver_user_id: driverUserId,
    event_key: eventKey,
  });
  if (!error) return "claimed";
  const code = String((error as { code?: string }).code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  if (code === "23505" || message.includes("duplicate")) return "duplicate";
  console.error("[driverReview] alert ledger unavailable", error.message);
  return "unavailable";
}

function decisionTemplate(
  status: DriverReviewTarget,
  locale: string,
  reason: string | null,
) {
  if (status === "approved") return driverApprovedEmail({ locale });
  if (status === "rejected") return driverRejectedEmail({ locale, reason });
  if (status === "suspended") return driverSuspendedEmail({ locale, reason });
  return driverDisabledEmail({ locale, reason });
}

/**
 * One decision, one driver notification. The caller must already have won the
 * status compare-and-swap. A duplicate event key does not send again.
 */
export async function notifyDriverStatusDecision(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  status: DriverReviewTarget;
  fromStatus: string;
  reviewedAt: string;
  decisionNote: string | null;
}): Promise<{ notified: boolean }> {
  const eventKey = decisionEventKey({
    from: params.fromStatus,
    to: params.status,
    reviewedAt: params.reviewedAt,
  });
  const claimed = await claimDriverReviewAlert(
    params.supabaseAdmin,
    params.userId,
    eventKey,
  );
  if (claimed !== "claimed") return { notified: false };

  const note = decisionNoteForStatus(params.status, params.decisionNote);
  try {
    const locale = await loadPreferredLocale(params.supabaseAdmin, params.userId);
    const template = decisionTemplate(params.status, locale, note);
    await notifyUserTransactional({
      supabaseAdmin: params.supabaseAdmin,
      recipient: { userId: params.userId },
      subject: template.subject,
      body: renderTransactionalEmailText(template),
      html: renderTransactionalEmailHtml(template),
      idempotencyKey: eventKey,
    });
    await notifyDriverAccountDecisionPush({
      supabaseAdmin: params.supabaseAdmin,
      userId: params.userId,
      status: params.status,
      reason: note,
    });
  } catch (error) {
    console.error(
      "[driverReview] decision notify failed",
      error instanceof Error ? error.message : "error",
    );
    return { notified: false };
  }

  return { notified: true };
}

type ReviewerRow = {
  id: string;
  role: string | null;
  is_founder: boolean | null;
  email: string | null;
  account_status: string | null;
};

async function reviewerEmail(
  supabaseAdmin: SupabaseClient,
  row: ReviewerRow,
): Promise<string | null> {
  const fromProfile = String(row.email ?? "").trim();
  if (fromProfile.includes("@")) return fromProfile;
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(row.id);
  if (error) return null;
  const email = String(data.user?.email ?? "").trim();
  return email.includes("@") ? email : null;
}

export async function notifyDriverReviewers(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  driverName?: string | null;
  eventKey: string;
  resubmission?: boolean;
}): Promise<{ notified: number; skipped: boolean }> {
  const claimed = await claimDriverReviewAlert(
    params.supabaseAdmin,
    params.driverUserId,
    params.eventKey,
  );
  if (claimed !== "claimed") return { notified: 0, skipped: true };

  const reviewUrl = driverAdminReviewUrl(params.driverUserId);
  if (!reviewUrl) return { notified: 0, skipped: true };

  const { data, error } = await params.supabaseAdmin
    .from("profiles")
    .select("id, role, is_founder, email, account_status")
    .or(
      "is_founder.eq.true,role.eq.super_admin,role.eq.operations_admin,role.eq.review_admin",
    );

  if (error) {
    console.error("[driverReview] reviewer lookup failed", error.message);
    return { notified: 0, skipped: true };
  }

  let notified = 0;
  for (const row of (data ?? []) as ReviewerRow[]) {
    if (row.id === params.driverUserId) continue;
    if (!isAccountActive(row.account_status)) continue;
    if (!isDriverReviewerAccount(row.role, row.is_founder === true)) continue;
    const email = await reviewerEmail(params.supabaseAdmin, row);
    if (!email) continue;
    const locale = await loadPreferredLocale(params.supabaseAdmin, row.id);
    const template = driverReviewRequestedEmail({
      locale,
      driverName: params.driverName,
      reviewUrl,
      resubmission: params.resubmission === true,
    });
    try {
      const result = await sendTransactionalTemplateEmail({ to: email, template });
      if (result.ok) notified += 1;
    } catch (sendError) {
      console.error(
        "[driverReview] reviewer email failed",
        sendError instanceof Error ? sendError.message : "error",
      );
    }
    if (notified >= 40) break;
  }

  return { notified, skipped: false };
}

export async function notifyReviewersOfPendingSignup(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  driverName?: string | null;
}): Promise<{ notified: number; skipped: boolean }> {
  const { data: later } = await params.supabaseAdmin
    .from("driver_review_alerts")
    .select("event_key")
    .eq("driver_user_id", params.driverUserId)
    .like("event_key", "awaiting:resubmit:%")
    .limit(1);
  if ((later ?? []).length > 0) return { notified: 0, skipped: true };

  return notifyDriverReviewers({
    supabaseAdmin: params.supabaseAdmin,
    driverUserId: params.driverUserId,
    driverName: params.driverName,
    eventKey: PENDING_SIGNUP_ALERT_KEY,
    resubmission: false,
  });
}

export async function notifyReviewersOfResubmit(params: {
  supabaseAdmin: SupabaseClient;
  driverUserId: string;
  driverName?: string | null;
  updatedAt: string;
}): Promise<{ notified: number; skipped: boolean }> {
  return notifyDriverReviewers({
    supabaseAdmin: params.supabaseAdmin,
    driverUserId: params.driverUserId,
    driverName: params.driverName,
    eventKey: resubmitAlertKey(params.updatedAt),
    resubmission: true,
  });
}

export function decisionPushDoesNotOpenHome(status: DriverReviewTarget): boolean {
  const copy = driverDecisionPush(status, "en");
  return copy.title.length > 0 && !copy.body.includes("DriverTabs");
}
