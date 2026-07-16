import type { SupabaseClient } from "@supabase/supabase-js";

import { mapTwilioCallStatus } from "./chatReceiptStatus";

export type MappedCallStatus = ReturnType<typeof mapTwilioCallStatus>;

/** Terminal statuses must not be overwritten by earlier ringing events. */
const CALL_STATUS_RANK: Record<string, number> = {
  active: 0,
  ringing: 1,
  connected: 2,
  completed: 3,
  missed: 3,
  declined: 3,
  failed: 3,
  canceled: 3,
  expired: 3,
};

function statusRank(status: string | null | undefined): number {
  return CALL_STATUS_RANK[String(status ?? "").trim().toLowerCase()] ?? -1;
}

function shouldApplyStatusUpdate(
  currentStatus: string | null | undefined,
  nextStatus: MappedCallStatus,
): boolean {
  if (!nextStatus) return false;
  const current = String(currentStatus ?? "active").trim().toLowerCase();
  if (current === nextStatus) return true;
  return statusRank(nextStatus) >= statusRank(current);
}

export type TwilioStatusCallbackInput = {
  callSid: string;
  dialCallSid?: string | null;
  callStatus: string;
  fromPhone?: string | null;
  toPhone?: string | null;
  durationSeconds?: number | null;
  errorCode?: string | null;
  payload: Record<string, string>;
};

export async function applyTwilioStatusCallback(params: {
  supabaseAdmin: SupabaseClient;
  input: TwilioStatusCallbackInput;
}): Promise<{ sessionId: string | null; mappedStatus: MappedCallStatus }> {
  const { supabaseAdmin, input } = params;
  const mappedStatus = mapTwilioCallStatus(input.callStatus);
  const now = new Date().toISOString();

  let sessionId: string | null = null;

  if (input.callSid) {
    const { data: session } = await supabaseAdmin
      .from("call_sessions")
      .select("id, status, started_at, answered_at")
      .or(
        `twilio_call_sid.eq.${input.callSid},caller_phone.eq.${input.fromPhone ?? ""}`,
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = session as {
      id?: string;
      status?: string | null;
      started_at?: string | null;
      answered_at?: string | null;
    } | null;

    sessionId = row?.id ?? null;

    if (sessionId && mappedStatus && shouldApplyStatusUpdate(row?.status, mappedStatus)) {
      const update: Record<string, unknown> = {
        status: mappedStatus,
        final_status: mappedStatus,
        twilio_call_sid: input.callSid,
      };

      if (mappedStatus === "ringing" && !row?.started_at) {
        update.started_at = now;
      }

      if (mappedStatus === "connected") {
        update.answered_at = row?.answered_at ?? now;
        update.started_at = row?.started_at ?? now;
      }

      if (
        mappedStatus === "completed" ||
        mappedStatus === "missed" ||
        mappedStatus === "declined" ||
        mappedStatus === "failed" ||
        mappedStatus === "canceled"
      ) {
        update.ended_at = now;
      }

      if (
        Number.isFinite(input.durationSeconds) &&
        (input.durationSeconds ?? 0) > 0
      ) {
        update.duration_seconds = input.durationSeconds;
      }

      if (input.errorCode) {
        update.failure_code = input.errorCode;
      }

      await supabaseAdmin.from("call_sessions").update(update).eq("id", sessionId);
    }
  }

  await supabaseAdmin.from("call_events").insert({
    call_session_id: sessionId,
    twilio_call_sid: input.callSid || null,
    dial_call_sid: input.dialCallSid || null,
    event_source: "status_callback",
    twilio_status: input.callStatus || "unknown",
    mapped_status: mappedStatus,
    from_phone: input.fromPhone || null,
    to_phone: input.toPhone || null,
    duration_seconds: Number.isFinite(input.durationSeconds)
      ? input.durationSeconds
      : null,
    failure_code: input.errorCode || null,
    payload: input.payload,
  });

  return { sessionId, mappedStatus };
}
