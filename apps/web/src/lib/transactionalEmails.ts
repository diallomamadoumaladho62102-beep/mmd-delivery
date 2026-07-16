import type { SupabaseClient } from "@supabase/supabase-js";

import {
  accountCreatedEmail,
  driverApprovedEmail,
  orderAcceptedEmail,
  orderCancelledEmail,
  orderConfirmationEmail,
  passwordResetEmail,
  restaurantApprovedEmail,
  sellerApprovedEmail,
  teamInvitationEmail,
  renderTransactionalEmailHtml,
  renderTransactionalEmailText,
  type TransactionalEmailTemplate,
} from "./transactionalEmailTemplates";
import {
  isTransactionalEmailEnabled,
  notifyUserTransactional,
  sendTransactionalEmail,
} from "./transactionalOutbound";

export { isTransactionalEmailEnabled };

export async function sendTransactionalTemplateEmail(params: {
  to: string;
  template: TransactionalEmailTemplate;
}): Promise<{ ok: boolean; skipped?: boolean }> {
  const to = String(params.to ?? "").trim();
  if (!to) return { ok: false, skipped: true };

  if (!isTransactionalEmailEnabled()) {
    return { ok: false, skipped: true };
  }

  const result = await sendTransactionalEmail({
    to,
    subject: params.template.subject,
    body: renderTransactionalEmailText(params.template),
    html: renderTransactionalEmailHtml(params.template),
  });

  return { ok: result.ok, skipped: result.skipped };
}

export async function notifyAccountCreatedEmail(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  name?: string | null;
}): Promise<void> {
  const template = accountCreatedEmail({ name: params.name });
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.userId },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}

export async function notifyOrderConfirmationEmail(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  orderId: string;
  restaurantName?: string | null;
}): Promise<void> {
  if (!params.clientUserId) return;
  const template = orderConfirmationEmail({
    orderId: params.orderId,
    restaurantName: params.restaurantName,
  });
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}

export async function notifyOrderAcceptedEmail(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  orderId: string;
  prepMinutes?: number | null;
}): Promise<void> {
  if (!params.clientUserId) return;
  const template = orderAcceptedEmail({
    orderId: params.orderId,
    prepMinutes: params.prepMinutes,
  });
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}

export async function notifyOrderCancelledEmail(params: {
  supabaseAdmin: SupabaseClient;
  clientUserId: string | null;
  orderId: string;
  refund?: string | null;
}): Promise<void> {
  if (!params.clientUserId) return;
  const template = orderCancelledEmail({
    orderId: params.orderId,
    refund: params.refund,
  });
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.clientUserId },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}

export async function notifyDriverApprovedEmail(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
}): Promise<void> {
  const template = driverApprovedEmail();
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.userId },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}

export async function notifyRestaurantApprovedEmail(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  restaurantName?: string | null;
}): Promise<void> {
  const template = restaurantApprovedEmail({
    restaurantName: params.restaurantName,
  });
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.userId },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}

export async function notifySellerApprovedEmail(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  businessName?: string | null;
}): Promise<void> {
  const template = sellerApprovedEmail({
    businessName: params.businessName,
  });
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.userId },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}

export async function notifyPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}): Promise<{ ok: boolean; skipped?: boolean }> {
  const template = passwordResetEmail({ resetUrl: params.resetUrl });
  return sendTransactionalTemplateEmail({ to: params.to, template });
}

export async function notifyTeamInvitationEmail(params: {
  supabaseAdmin: SupabaseClient;
  userId?: string | null;
  email?: string | null;
  inviteeName?: string | null;
  invitedBy?: string | null;
}): Promise<void> {
  const template = teamInvitationEmail({
    inviteeName: params.inviteeName,
    invitedBy: params.invitedBy,
  });
  await notifyUserTransactional({
    supabaseAdmin: params.supabaseAdmin,
    recipient: { userId: params.userId, email: params.email },
    subject: template.subject,
    body: renderTransactionalEmailText(template),
    html: renderTransactionalEmailHtml(template),
  });
}
