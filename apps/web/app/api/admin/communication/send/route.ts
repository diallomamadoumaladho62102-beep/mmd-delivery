import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanSendCommunication } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  communicationErrorMessage,
  isSupabaseUserId,
  mapProviderFailure,
  type CommunicationErrorCode,
} from "@/lib/adminCommunicationErrors";
import {
  sendAdminEmail,
  sendAdminPush,
  sendAdminSms,
  type OutboundChannel,
} from "@/lib/adminOutbound";
import { notifyTeamInvitationEmail } from "@/lib/transactionalEmails";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function fail(code: CommunicationErrorCode, status = 400, details?: unknown) {
  return json(
    {
      ok: false,
      code,
      error: communicationErrorMessage(code),
      details: details ?? null,
    },
    status
  );
}

function getClientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanSendCommunication(request);
    const supabase = buildSupabaseAdminClient();

    const body = (await request.json().catch(() => ({}))) as {
      channel?: OutboundChannel;
      userId?: string;
      to?: string;
      title?: string;
      subject?: string;
      message?: string;
    };

    const channel = String(body.channel ?? "").trim().toLowerCase() as OutboundChannel;
    const message = String(body.message ?? "").trim();
    const userId = String(body.userId ?? "").trim();

    if (!["push", "sms", "email"].includes(channel)) {
      return fail("invalid_channel", 400);
    }
    if (!message) return fail("missing_message", 400);

    let recipientAddress = String(body.to ?? "").trim();
    let recipientUserId: string | null = userId || null;
    let profileRole: string | null = null;

    if (userId) {
      if (!isSupabaseUserId(userId)) {
        return fail("invalid_user_id", 400, { provided: userId });
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, phone, role")
        .eq("id", userId)
        .maybeSingle();

      if (!profile) return fail("user_not_found", 404);

      profileRole = String(profile.role ?? "").trim() || null;

      if (channel === "email" && !recipientAddress) {
        recipientAddress = String(profile.email ?? "").trim();
      }
      if (channel === "sms" && !recipientAddress) {
        recipientAddress = String(profile.phone ?? "").trim();
      }
    }

    if (channel === "push") {
      if (!userId) return fail("invalid_user_id", 400);
    }

    if (channel === "sms" && !recipientAddress) {
      return fail("missing_phone", 400);
    }

    if (channel === "email" && !recipientAddress) {
      return fail("missing_email", 400);
    }

    let result: { ok: boolean; response: Record<string, unknown> };

    if (channel === "push") {
      const pushRole =
        profileRole === "driver" ||
        profileRole === "restaurant" ||
        profileRole === "client"
          ? profileRole
          : "client";

      result = await sendAdminPush({
        userId,
        title: String(body.title ?? "MMD Delivery").trim(),
        body: message,
        role: pushRole,
      });
    } else if (channel === "sms") {
      if (!process.env.TWILIO_ACCOUNT_SID?.trim()) {
        return fail("missing_push_config", 503, { provider: "twilio" });
      }
      result = await sendAdminSms({ to: recipientAddress, body: message });
    } else {
      if (
        !process.env.RESEND_API_KEY?.trim() ||
        !process.env.ADMIN_EMAIL_FROM?.trim()
      ) {
        return fail("missing_push_config", 503, { provider: "resend" });
      }

      if (recipientUserId) {
        await notifyTeamInvitationEmail({
          supabaseAdmin: supabase,
          userId: recipientUserId,
          email: recipientAddress,
          inviteeName: null,
          invitedBy: "MMD Admin",
        });
        result = { ok: true, response: { ok: true, template: "team_invitation" } };
      } else {
        result = await sendAdminEmail({
          to: recipientAddress,
          subject: String(body.subject ?? "MMD Delivery").trim(),
          body: message,
        });
      }
    }

    const ip = getClientIp(request);
    const failureCode = result.ok ? null : mapProviderFailure(result.response);

    await supabase.from("admin_communication_logs").insert({
      sent_by: session.userId,
      channel,
      recipient_user_id: recipientUserId,
      recipient_address: recipientAddress || null,
      subject: channel === "email" ? String(body.subject ?? "").trim() || null : null,
      body: message,
      status: result.ok ? "sent" : "failed",
      provider_response: {
        ...result.response,
        failure_code: failureCode,
      },
      ip_address: ip,
    });

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: `communication_${channel}`,
      targetType: "user",
      targetId: userId || recipientAddress,
      newValues: {
        channel,
        status: result.ok ? "sent" : "failed",
        failure_code: failureCode,
        recipient: recipientAddress || userId,
      },
      request,
    });

    if (!result.ok) {
      const code = failureCode ?? "provider_error";
      return json(
        {
          ok: false,
          code,
          error: communicationErrorMessage(code),
          details: result.response,
        },
        code === "missing_push_config" ? 503 : 502
      );
    }

    return json({ ok: true, channel, details: result.response });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return fail("unauthorized", e.status, { message: e.message });
    }
    return json(
      {
        ok: false,
        code: "provider_error",
        error: e instanceof Error ? e.message : "Server error",
      },
      500
    );
  }
}
