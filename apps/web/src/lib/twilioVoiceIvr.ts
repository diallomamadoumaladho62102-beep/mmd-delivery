import type { NextRequest } from "next/server";

import {
  buildIvrConnectTwiml,
  buildIvrGatherTwiml,
  buildIvrUnavailableTwiml,
  decideIvrGather,
  getSupportPhoneForService,
  parseIvrAttempt,
  pickInboundSupportDestination,
  type AdminVoiceService,
} from "@/lib/adminVoiceIvr";
import {
  fetchAdminVoiceStaffProfiles,
  getAdminSupportPhone,
} from "@/lib/adminVoiceTransfer";
import { normalizePhoneE164 } from "@/lib/phoneE164";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  assertTwilioWebhookRequest,
  formDataToParamRecord,
} from "@/lib/twilioRequestValidation";
import { twilioVoiceTwiml } from "@/lib/twilioVoiceIncoming";

async function persistIvrProgress(params: {
  callSid: string;
  fromPhone: string | null;
  patch: Record<string, unknown>;
}) {
  if (!params.callSid) return;
  const supabaseAdmin = buildSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    ...params.patch,
    updated_at: nowIso,
  };

  const updated = await supabaseAdmin
    .from("admin_voice_calls")
    .update(patch)
    .eq("parent_call_sid", params.callSid)
    .select("id")
    .maybeSingle();

  if (updated.error) {
    console.error("[twilio/voice/ivr] persist failed", {
      path: "/api/twilio/voice/ivr",
      code: updated.error.code,
    });
    return;
  }

  if (updated.data?.id) return;

  const inserted = await supabaseAdmin.from("admin_voice_calls").insert({
    parent_call_sid: params.callSid,
    from_phone: normalizePhoneE164(params.fromPhone),
    current_admin_phone:
      String(patch.current_admin_phone || "").trim() || getAdminSupportPhone(),
    status: String(patch.status || "in_ivr"),
    ivr_attempts: 0,
    ...patch,
  });

  if (inserted.error) {
    console.error("[twilio/voice/ivr] persist failed", {
      path: "/api/twilio/voice/ivr",
      code: inserted.error.code,
    });
  }
}

export async function handleTwilioVoiceIvr(req: NextRequest) {
  const formData = await req.formData();
  const twilioParams = await formDataToParamRecord(formData);
  const twilioAuth = await assertTwilioWebhookRequest(req, twilioParams);

  if (twilioAuth.ok === false) {
    return new Response(twilioAuth.message, { status: twilioAuth.status });
  }

  const callSid = String(formData.get("CallSid") || "").trim();
  const fromPhone = normalizePhoneE164(String(formData.get("From") || "").trim());
  const digits = String(formData.get("Digits") || "").trim();
  const attempt = parseIvrAttempt(req.nextUrl.searchParams.get("attempt"));
  const decision = decideIvrGather({ digits, attempt });

  if (decision.action === "repeat") {
    try {
      await persistIvrProgress({
        callSid,
        fromPhone,
        patch: {
          ivr_attempts: decision.attempt,
          status: "in_ivr",
        },
      });
    } catch {
      console.error("[twilio/voice/ivr] persist failed", {
        path: "/api/twilio/voice/ivr",
      });
    }
    return twilioVoiceTwiml(
      buildIvrGatherTwiml({
        attempt: decision.attempt,
        invalid: decision.invalid,
      }),
    );
  }

  const service: AdminVoiceService = decision.service;
  let destPhone = getSupportPhoneForService(service);
  let assignedAdminUserId: string | null = null;

  try {
    const supabaseAdmin = buildSupabaseAdminClient();
    const profiles = await fetchAdminVoiceStaffProfiles(supabaseAdmin);
    const picked = pickInboundSupportDestination({
      profiles,
      preferredPhone: destPhone,
    });
    if (picked) {
      destPhone = picked.phone;
      assignedAdminUserId = picked.userId;
    } else {
      destPhone = "";
    }
  } catch {
    console.error("[twilio/voice/ivr] destination lookup failed", {
      path: "/api/twilio/voice/ivr",
    });
  }

  try {
    await persistIvrProgress({
      callSid,
      fromPhone,
      patch: {
        ivr_digit: decision.digit,
        service,
        ivr_attempts: attempt,
        status: destPhone ? "ringing" : "missed",
        current_admin_phone: destPhone || getAdminSupportPhone(),
        assigned_admin_user_id: assignedAdminUserId,
        current_admin_user_id: assignedAdminUserId,
      },
    });
  } catch {
    console.error("[twilio/voice/ivr] persist failed", {
      path: "/api/twilio/voice/ivr",
    });
  }

  if (!destPhone) {
    return twilioVoiceTwiml(buildIvrUnavailableTwiml());
  }

  return twilioVoiceTwiml(
    buildIvrConnectTwiml({
      service,
      destPhone,
      fallback: decision.action === "fallback",
    }),
  );
}
