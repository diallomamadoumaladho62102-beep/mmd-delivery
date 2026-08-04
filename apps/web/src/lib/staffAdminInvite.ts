import type { SupabaseClient, User } from "@supabase/supabase-js";
import { roleDisplayName, type StaffRole } from "@/lib/adminRbac";
import { getResetPasswordRedirectUrl } from "@/lib/productionSite";
import {
  isTransactionalEmailEnabled,
  sendTransactionalTemplateEmail,
} from "@/lib/transactionalEmails";
import { staffAdminInvitationEmail } from "@/lib/transactionalEmailTemplates";

export type StaffInviteResult = {
  userId: string;
  createdAuthUser: boolean;
  inviteSent: boolean;
  inviteSkipped: boolean;
  inviteError?: string;
  actionLinkGenerated: boolean;
};

async function findAuthUserByEmail(
  supabaseAdmin: SupabaseClient,
  email: string
): Promise<User | null> {
  const normalized = email.trim().toLowerCase();

  // Prefer per-email lookup when available (supabase-js admin API).
  const byEmail = (
    supabaseAdmin.auth.admin as {
      getUserByEmail?: (email: string) => Promise<{
        data: { user: User | null };
        error: { message: string } | null;
      }>;
    }
  ).getUserByEmail;

  if (typeof byEmail === "function") {
    const { data, error } = await byEmail.call(supabaseAdmin.auth.admin, normalized);
    if (!error && data?.user) return data.user;
  }

  // Fallback: page through users (small staff volumes).
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) break;
    const match = (data.users ?? []).find(
      (u) => String(u.email ?? "").trim().toLowerCase() === normalized
    );
    if (match) return match;
    if ((data.users ?? []).length < 200) break;
  }

  return null;
}

/**
 * Ensure Auth user exists, then email a secure set-password / invite link.
 * Does not invent a temporary password — the admin chooses their own.
 */
export async function ensureStaffAuthUserAndSendInvite(params: {
  supabaseAdmin: SupabaseClient;
  email: string;
  fullName?: string | null;
  role: StaffRole;
  invitedByName?: string | null;
  /** Existing auth user id if already known from profiles */
  existingUserId?: string | null;
}): Promise<StaffInviteResult> {
  const email = params.email.trim().toLowerCase();
  let userId = String(params.existingUserId ?? "").trim();
  let createdAuthUser = false;

  const redirectTo = `${getResetPasswordRedirectUrl()}?next=${encodeURIComponent("/admin/login")}`;
  const meta = {
    full_name: params.fullName ?? undefined,
    staff_role: params.role,
    invited_as_staff: true,
  };

  if (!userId) {
    const existing = await findAuthUserByEmail(params.supabaseAdmin, email);
    if (existing?.id) {
      userId = existing.id;
    } else if (!isTransactionalEmailEnabled()) {
      // Prefer Supabase-native invite (creates Auth user + sends Auth email).
      const { data: invited, error: inviteErr } =
        await params.supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: meta,
          redirectTo,
        });
      if (inviteErr || !invited.user?.id) {
        throw new Error(inviteErr?.message ?? "Failed to invite auth user");
      }
      return {
        userId: invited.user.id,
        createdAuthUser: true,
        inviteSent: true,
        inviteSkipped: false,
        actionLinkGenerated: true,
      };
    } else {
      const { data: created, error: createErr } =
        await params.supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: meta,
        });

      if (createErr || !created.user?.id) {
        const raced = await findAuthUserByEmail(params.supabaseAdmin, email);
        if (!raced?.id) {
          throw new Error(createErr?.message ?? "Failed to create auth user");
        }
        userId = raced.id;
      } else {
        userId = created.user.id;
        createdAuthUser = true;
      }
    }
  }

  // Custom Resend email with invite/recovery action link.
  const linkType = createdAuthUser ? "invite" : "recovery";
  const { data: linkData, error: linkErr } =
    await params.supabaseAdmin.auth.admin.generateLink({
      type: linkType,
      email,
      options: { redirectTo },
    });

  const actionLink = linkData?.properties?.action_link
    ? String(linkData.properties.action_link)
    : "";

  if (linkErr || !actionLink) {
    return {
      userId,
      createdAuthUser,
      inviteSent: false,
      inviteSkipped: false,
      actionLinkGenerated: false,
      inviteError: linkErr?.message ?? "Unable to generate invite link",
    };
  }

  if (!isTransactionalEmailEnabled()) {
    // Existing users: cannot use inviteUserByEmail again. Ask Founder to use
    // Resend once Resend is enabled, or admin login "Forgot password".
    return {
      userId,
      createdAuthUser,
      inviteSent: false,
      inviteSkipped: true,
      actionLinkGenerated: true,
      inviteError:
        "Transactional email is not configured. Use Forgot password on /admin/login, or enable TRANSACTIONAL_EMAIL_ENABLED + RESEND_API_KEY.",
    };
  }

  const template = staffAdminInvitationEmail({
    inviteeName: params.fullName,
    invitedBy: params.invitedByName,
    roleLabel: roleDisplayName(params.role),
    inviteUrl: actionLink,
  });

  const sent = await sendTransactionalTemplateEmail({
    to: email,
    template,
  });

  return {
    userId,
    createdAuthUser,
    inviteSent: sent.ok === true && !sent.skipped,
    inviteSkipped: sent.skipped === true,
    actionLinkGenerated: true,
    inviteError: sent.ok ? undefined : "Failed to send invitation email",
  };
}
