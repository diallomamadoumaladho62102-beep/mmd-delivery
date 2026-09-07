import type { NextRequest } from "next/server";

import {
  adminVoiceConferenceName,
  createTwilioOutboundCall,
  buildConferenceJoinTwiml,
} from "@/lib/adminVoiceConference";
import {
  buildIvrConferenceConnectTwiml,
  buildIvrConnectTwiml,
  buildIvrLanguageGatherTwiml,
  buildIvrServiceGatherTwiml,
  buildIvrUnavailableTwiml,
  decideIvrGather,
  decideIvrLanguageGather,
  getSupportPhoneForService,
  parseIvrAttempt,
  parseIvrLocale,
  parseIvrStep,
  pickInboundSupportDestination,
  type AdminVoiceService,
  type IvrVoiceLocale,
} from "@/lib/adminVoiceIvr";
import {
  fetchAdminVoiceStaffProfiles,
  getAdminSupportPhone,
  getPublicVoiceCallerId,
  getTwilioVoiceCreds,
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
}): Promise<string | null> {
  if (!params.callSid) return null;
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
    return null;
  }

  if (updated.data?.id) return String(updated.data.id);

  const inserted = await supabaseAdmin
    .from("admin_voice_calls")
    .insert({
      parent_call_sid: params.callSid,
      from_phone: normalizePhoneE164(params.fromPhone),
      current_admin_phone:
        String(patch.current_admin_phone || "").trim() || getAdminSupportPhone(),
      status: String(patch.status || "in_ivr"),
      ivr_attempts: 0,
      ...patch,
    })
    .select("id")
    .maybeSingle();

  if (inserted.error) {
    console.error("[twilio/voice/ivr] persist failed", {
      path: "/api/twilio/voice/ivr",
      code: inserted.error.code,
    });
    return null;
  }

  return inserted.data?.id ? String(inserted.data.id) : null;
}

async function connectSelectedService(params: {
  callSid: string;
  fromPhone: string | null;
  attempt: number;
  locale: IvrVoiceLocale;
  decision:
    | { action: "connect"; digit: string; service: AdminVoiceService }
    | { action: "fallback"; digit: "0"; service: "general" };
}) {
  const service: AdminVoiceService = params.decision.service;
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

  let callId: string | null = null;
  try {
    callId = await persistIvrProgress({
      callSid: params.callSid,
      fromPhone: params.fromPhone,
      patch: {
        ivr_digit: params.decision.digit,
        service,
        ivr_attempts: params.attempt,
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
    return twilioVoiceTwiml(buildIvrUnavailableTwiml(params.locale));
  }

  if (callId) {
    const conferenceName = adminVoiceConferenceName(callId);
    const creds = getTwilioVoiceCreds();
    const supabaseAdmin = buildSupabaseAdminClient();

    await supabaseAdmin
      .from("admin_voice_calls")
      .update({
        conference_name: conferenceName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", callId);

    if (creds) {
      const outbound = await createTwilioOutboundCall({
        accountSid: creds.sid,
        authToken: creds.token,
        to: destPhone,
        from: getPublicVoiceCallerId(),
        twiml: buildConferenceJoinTwiml({
          conferenceName,
          startOnEnter: true,
          endOnExit: false,
        }),
      });

      if (outbound.ok) {
        await supabaseAdmin
          .from("admin_voice_calls")
          .update({
            child_call_sid: outbound.sid,
            updated_at: new Date().toISOString(),
          })
          .eq("id", callId);

        return twilioVoiceTwiml(
          buildIvrConferenceConnectTwiml({
            conferenceName,
            locale: params.locale,
            fallback: params.decision.action === "fallback",
          }),
        );
      }

      console.error("[twilio/voice/ivr] conference outbound failed", {
        path: "/api/twilio/voice/ivr",
        status: outbound.ok ? 200 : outbound.status,
      });
    }
  }

  return twilioVoiceTwiml(
    buildIvrConnectTwiml({
      service,
      destPhone,
      locale: params.locale,
      fallback: params.decision.action === "fallback",
    }),
  );
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
  const step = parseIvrStep(req.nextUrl.searchParams.get("step"));
  const localeFromQuery = parseIvrLocale(req.nextUrl.searchParams.get("locale"));

  // Phase 1 — language must be chosen before any service menu.
  if (step === "language" || !localeFromQuery) {
    const languageDecision = decideIvrLanguageGather({ digits, attempt });

    if (languageDecision.action === "repeat") {
      try {
        await persistIvrProgress({
          callSid,
          fromPhone,
          patch: {
            ivr_attempts: languageDecision.attempt,
            status: "in_ivr",
          },
        });
      } catch {
        console.error("[twilio/voice/ivr] persist failed", {
          path: "/api/twilio/voice/ivr",
        });
      }
      return twilioVoiceTwiml(
        buildIvrLanguageGatherTwiml({
          attempt: languageDecision.attempt,
          invalid: languageDecision.invalid,
        }),
      );
    }

    const locale = languageDecision.locale;
    try {
      await persistIvrProgress({
        callSid,
        fromPhone,
        patch: {
          ivr_digit: languageDecision.digit,
          ivr_attempts: 0,
          status: "in_ivr",
        },
      });
    } catch {
      console.error("[twilio/voice/ivr] persist failed", {
        path: "/api/twilio/voice/ivr",
      });
    }

    return twilioVoiceTwiml(
      buildIvrServiceGatherTwiml({
        locale,
        attempt: 0,
        invalid: false,
      }),
    );
  }

  // Phase 2 — service menu in the caller's chosen locale.
  const locale = localeFromQuery;
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
      buildIvrServiceGatherTwiml({
        locale,
        attempt: decision.attempt,
        invalid: decision.invalid,
      }),
    );
  }

  return connectSelectedService({
    callSid,
    fromPhone,
    attempt,
    locale,
    decision,
  });
}
