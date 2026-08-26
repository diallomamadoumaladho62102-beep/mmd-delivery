import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAdminEmail } from "./adminOutbound";
import { canSendUsA2pSms, isTransactionalSmsEnabled as a2pTransactionalEnabled } from "./smsA2p";
import { sendProgramSms, type SmsMessageType } from "./smsOutbound";
import { renderSmsTemplate } from "./smsTemplates";

export type TransactionalRecipient = {
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
};

function truthyEnv(name: string): boolean {
  return ["true", "1", "yes"].includes(
    String(process.env[name] ?? "").trim().toLowerCase(),
  );
}

export function isTransactionalSmsEnabled(): boolean {
  return a2pTransactionalEnabled();
}

export function isTransactionalEmailEnabled(): boolean {
  return truthyEnv("TRANSACTIONAL_EMAIL_ENABLED");
}

async function loadProfileContact(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<{ email: string | null; phone: string | null }> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("email, phone")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.log("[transactional] profile lookup failed:", error.message);
    return { email: null, phone: null };
  }

  const row = data as { email?: string | null; phone?: string | null } | null;
  return {
    email: String(row?.email ?? "").trim() || null,
    phone: String(row?.phone ?? "").trim() || null,
  };
}

export async function sendTransactionalSms(params: {
  to: string;
  body: string;
  supabaseAdmin?: SupabaseClient;
  userId?: string | null;
  messageType?: SmsMessageType;
  idempotencyKey?: string;
}): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  if (!isTransactionalSmsEnabled()) {
    return { ok: false, skipped: true, reason: "transactional_sms_disabled" };
  }
  const a2p = canSendUsA2pSms();
  if (a2p.ok === false) {
    return { ok: false, skipped: true, reason: a2p.reason };
  }

  const to = String(params.to ?? "").trim();
  const body = String(params.body ?? "").trim();
  if (!to || !body) return { ok: false, skipped: true, reason: "invalid_destination_or_body" };

  if (!params.supabaseAdmin) {
    return { ok: false, skipped: true, reason: "missing_supabase" };
  }

  const result = await sendProgramSms({
    supabase: params.supabaseAdmin,
    to,
    body,
    messageType: params.messageType ?? "admin",
    userId: params.userId,
    idempotencyKey: params.idempotencyKey,
  });
  return { ok: result.ok, skipped: result.skipped, reason: result.reason };
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  body: string;
  html?: string | null;
}): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!isTransactionalEmailEnabled()) {
    return { ok: false, skipped: true };
  }

  const to = String(params.to ?? "").trim();
  const subject = String(params.subject ?? "").trim();
  const body = String(params.body ?? "").trim();
  const html = String(params.html ?? "").trim();
  if (!to || !subject || !body) return { ok: false, skipped: true };

  const result = await sendAdminEmail({
    to,
    subject,
    body,
    html: html || undefined,
  });
  return { ok: result.ok, skipped: false };
}

export async function notifyUserTransactional(params: {
  supabaseAdmin: SupabaseClient;
  recipient: TransactionalRecipient;
  subject: string;
  body: string;
  html?: string | null;
  messageType?: SmsMessageType;
  idempotencyKey?: string;
}): Promise<void> {
  let email = String(params.recipient.email ?? "").trim() || null;
  let phone = String(params.recipient.phone ?? "").trim() || null;

  if ((!email || !phone) && params.recipient.userId) {
    const profile = await loadProfileContact(
      params.supabaseAdmin,
      params.recipient.userId,
    );
    email = email ?? profile.email;
    phone = phone ?? profile.phone;
  }

  if (email) {
    await sendTransactionalEmail({
      to: email,
      subject: params.subject,
      body: params.body,
      html: params.html,
    });
  }

  if (phone) {
    await sendTransactionalSms({
      to: phone,
      body: params.body,
      supabaseAdmin: params.supabaseAdmin,
      userId: params.recipient.userId,
      messageType: params.messageType ?? "admin",
      idempotencyKey: params.idempotencyKey,
    });
  }
}

export async function notifyOrderDeliveredTransactional(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  orderId: string;
  dropoffAddress?: string | null;
}): Promise<void> {
  if (!params.clientUserId) return;

  const body = renderSmsTemplate("order_delivered", { ref: params.orderId });

  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: `MMD Delivery — order delivered`,
    body,
    messageType: "order_delivered",
    idempotencyKey: `order_delivered:${params.orderId}`,
  });
}

export async function notifyOrderDispatchedTransactional(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  orderId: string;
}): Promise<void> {
  if (!params.clientUserId) return;

  const body = renderSmsTemplate("order_dispatched", { ref: params.orderId });

  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: `MMD Delivery — driver assigned`,
    body,
    messageType: "order_dispatched",
    idempotencyKey: `order_dispatched:${params.orderId}`,
  });
}

export async function notifyDeliveryRequestDispatchedTransactional(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  deliveryRequestId: string;
}): Promise<void> {
  if (!params.clientUserId) return;

  const body = renderSmsTemplate("package_dispatched", {
    ref: params.deliveryRequestId,
  });

  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: `MMD Delivery — driver assigned`,
    body,
    messageType: "package_dispatched",
    idempotencyKey: `package_dispatched:${params.deliveryRequestId}`,
  });
}

export async function notifyTaxiRideDispatchedTransactional(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  taxiRideId: string;
}): Promise<void> {
  if (!params.clientUserId) return;

  const body = renderSmsTemplate("taxi_dispatched", { ref: params.taxiRideId });

  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: `MMD Delivery — driver assigned`,
    body,
    messageType: "taxi_dispatched",
    idempotencyKey: `taxi_dispatched:${params.taxiRideId}`,
  });
}
