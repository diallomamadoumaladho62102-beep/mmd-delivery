import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAdminEmail, sendAdminSms } from "./adminOutbound";

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
  return truthyEnv("TRANSACTIONAL_SMS_ENABLED");
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
}): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!isTransactionalSmsEnabled()) {
    return { ok: false, skipped: true };
  }

  const to = String(params.to ?? "").trim();
  const body = String(params.body ?? "").trim();
  if (!to || !body) return { ok: false, skipped: true };

  const result = await sendAdminSms({ to, body });
  return { ok: result.ok, skipped: false };
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  body: string;
}): Promise<{ ok: boolean; skipped?: boolean }> {
  if (!isTransactionalEmailEnabled()) {
    return { ok: false, skipped: true };
  }

  const to = String(params.to ?? "").trim();
  const subject = String(params.subject ?? "").trim();
  const body = String(params.body ?? "").trim();
  if (!to || !subject || !body) return { ok: false, skipped: true };

  const result = await sendAdminEmail({ to, subject, body });
  return { ok: result.ok, skipped: false };
}

export async function notifyUserTransactional(params: {
  supabaseAdmin: SupabaseClient;
  recipient: TransactionalRecipient;
  subject: string;
  body: string;
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
    });
  }

  if (phone) {
    await sendTransactionalSms({ to: phone, body: params.body });
  }
}

export async function notifyOrderDeliveredTransactional(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  orderId: string;
  dropoffAddress?: string | null;
}): Promise<void> {
  if (!params.clientUserId) return;

  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const address = String(params.dropoffAddress ?? "").trim();
  const body = address
    ? `MMD Delivery: your order #${shortId} was delivered to ${address}.`
    : `MMD Delivery: your order #${shortId} was delivered. Thank you!`;

  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: `MMD Delivery — order #${shortId} delivered`,
    body,
  });
}

export async function notifyOrderDispatchedTransactional(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  orderId: string;
}): Promise<void> {
  if (!params.clientUserId) return;

  const shortId = params.orderId.slice(0, 8).toUpperCase();
  const body = `MMD Delivery: a driver is on the way for order #${shortId}. Track your order in the app.`;

  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: `MMD Delivery — driver assigned (#${shortId})`,
    body,
  });
}
