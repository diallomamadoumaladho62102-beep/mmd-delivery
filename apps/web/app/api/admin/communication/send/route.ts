import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanSendCommunication } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import {
  sendAdminEmail,
  sendAdminPush,
  sendAdminSms,
  type OutboundChannel,
} from "@/lib/adminOutbound";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
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
      return json({ ok: false, error: "Invalid channel" }, 400);
    }
    if (!message) return json({ ok: false, error: "message required" }, 400);

    let recipientAddress = String(body.to ?? "").trim();
    let recipientUserId: string | null = userId || null;

    if (userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, email, phone")
        .eq("id", userId)
        .maybeSingle();

      if (!profile) return json({ ok: false, error: "User not found" }, 404);

      if (channel === "email" && !recipientAddress) {
        recipientAddress = String(profile.email ?? "").trim();
      }
      if (channel === "sms" && !recipientAddress) {
        recipientAddress = String(profile.phone ?? "").trim();
      }
    }

    let result: { ok: boolean; response: Record<string, unknown> };

    if (channel === "push") {
      if (!userId) return json({ ok: false, error: "userId required for push" }, 400);
      result = await sendAdminPush({
        userId,
        title: String(body.title ?? "MMD Delivery").trim(),
        body: message,
        role: "client",
      });
    } else if (channel === "sms") {
      if (!recipientAddress) {
        return json({ ok: false, error: "Phone number required" }, 400);
      }
      result = await sendAdminSms({ to: recipientAddress, body: message });
    } else {
      if (!recipientAddress) {
        return json({ ok: false, error: "Email address required" }, 400);
      }
      result = await sendAdminEmail({
        to: recipientAddress,
        subject: String(body.subject ?? "MMD Delivery").trim(),
        body: message,
      });
    }

    const ip = getClientIp(request);

    await supabase.from("admin_communication_logs").insert({
      sent_by: session.userId,
      channel,
      recipient_user_id: recipientUserId,
      recipient_address: recipientAddress || null,
      subject: channel === "email" ? String(body.subject ?? "").trim() || null : null,
      body: message,
      status: result.ok ? "sent" : "failed",
      provider_response: result.response,
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
        recipient: recipientAddress || userId,
      },
      request,
    });

    if (!result.ok) {
      return json(
        { ok: false, error: "Send failed", details: result.response },
        502
      );
    }

    return json({ ok: true, channel, details: result.response });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
