import { NextRequest, NextResponse } from "next/server";

import {
  ADMIN_VOICE_CALL_PERMISSION,
  executeAdminVoiceTransfer,
  getTwilioVoiceCreds,
  parseTransferRequest,
  redirectTwilioParentCall,
  type AdminVoiceCallRow,
  type AdminVoiceDestinationProfile,
} from "@/lib/adminVoiceTransfer";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission(
      ADMIN_VOICE_CALL_PERMISSION,
      request,
    );
    const parsed = parseTransferRequest(await request.json().catch(() => null));
    if (parsed.ok === false) {
      return NextResponse.json(
        { ok: false, error: parsed.error },
        { status: parsed.status },
      );
    }

    const creds = getTwilioVoiceCreds();
    if (!creds) {
      return NextResponse.json(
        { ok: false, error: "Twilio Voice is not configured" },
        { status: 503 },
      );
    }

    const supabase = buildSupabaseAdminClient();
    const result = await executeAdminVoiceTransfer({
      actor: {
        userId: session.userId,
        role: session.role,
        isFounder: session.isFounder,
      },
      callId: parsed.callId,
      destinationUserId: parsed.destinationUserId,
      deps: {
        loadCall: async (callId) => {
          const { data } = await supabase
            .from("admin_voice_calls")
            .select(
              "id, parent_call_sid, child_call_sid, from_phone, current_admin_user_id, current_admin_phone, assigned_admin_user_id, transferred_from_user_id, transferred_to_user_id, service, transfer_count, status, created_at, updated_at",
            )
            .eq("id", callId)
            .maybeSingle();
          return (data as AdminVoiceCallRow | null) ?? null;
        },
        loadDestination: async (userId) => {
          const { data } = await supabase
            .from("profiles")
            .select("id, full_name, email, role, is_founder, phone, account_status")
            .eq("id", userId)
            .maybeSingle();
          return (data as AdminVoiceDestinationProfile | null) ?? null;
        },
        updateCall: async (callId, patch) => {
          const { error } = await supabase
            .from("admin_voice_calls")
            .update(patch)
            .eq("id", callId);
          if (error) {
            throw new Error("Unable to update admin call");
          }
        },
        insertTransferEvent: async (event) => {
          await supabase.from("admin_voice_transfer_events").insert({
            call_id: event.call_id,
            from_admin_user_id: event.from_admin_user_id,
            to_admin_user_id: event.to_admin_user_id,
            service: event.service ?? null,
          });
        },
        redirectCall: async ({ callSid, twiml }) =>
          redirectTwilioParentCall({
            accountSid: creds.sid,
            authToken: creds.token,
            callSid,
            twiml,
          }),
      },
    });

    if (result.ok === false) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status },
      );
    }

    return NextResponse.json({
      ok: true,
      callId: result.callId,
      destinationUserId: result.destinationUserId,
    });
  } catch (error) {
    const status = error instanceof AdminAccessError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof AdminAccessError
            ? error.message
            : "Unable to transfer this call",
      },
      { status },
    );
  }
}
