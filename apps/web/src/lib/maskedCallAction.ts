import type { SupabaseClient } from "@supabase/supabase-js";

import { callSessionPersistPatch } from "@/lib/callSessionDisplay";
import {
  getTwilioVoiceCreds,
  hangupTwilioCall,
} from "@/lib/adminVoiceTransfer";

export type MaskedCallUserAction = "decline" | "end";

export function canControlMaskedCall(params: {
  userId: string;
  callerUserId: string | null;
  targetUserId: string | null;
}): boolean {
  const uid = String(params.userId || "").trim();
  if (!uid) return false;
  return (
    uid === String(params.callerUserId ?? "").trim() ||
    uid === String(params.targetUserId ?? "").trim()
  );
}

export function nextMaskedCallStatus(
  action: MaskedCallUserAction,
  actorUserId: string,
  callerUserId: string | null,
): "declined" | "canceled" | "completed" {
  if (action === "end") return "completed";
  if (String(callerUserId ?? "").trim() === actorUserId) return "canceled";
  return "declined";
}

export async function executeMaskedCallAction(params: {
  userId: string;
  sessionId: string;
  action: MaskedCallUserAction;
  supabaseAdmin: SupabaseClient;
  hangup?: (callSid: string) => Promise<{ ok: boolean; status: number; error?: string }>;
}): Promise<
  | { ok: true; status: string; ringingStopped: true }
  | { ok: false; status: number; error: string }
> {
  const sessionId = String(params.sessionId || "").trim();
  if (!sessionId) {
    return { ok: false, status: 400, error: "sessionId is required" };
  }

  const { data, error } = await params.supabaseAdmin
    .from("call_sessions")
    .select(
      "id, caller_user_id, target_user_id, twilio_call_sid, status, ended_at, expires_at",
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404, error: "Call not found" };
  }

  const row = data as {
    id: string;
    caller_user_id: string | null;
    target_user_id: string | null;
    twilio_call_sid: string | null;
    status: string | null;
    ended_at: string | null;
    expires_at: string | null;
  };

  if (
    !canControlMaskedCall({
      userId: params.userId,
      callerUserId: row.caller_user_id,
      targetUserId: row.target_user_id,
    })
  ) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const stale = callSessionPersistPatch(row);
  const nowIso = new Date().toISOString();
  const nextStatus =
    stale?.status ?? nextMaskedCallStatus(params.action, params.userId, row.caller_user_id);

  if (row.twilio_call_sid) {
    const creds = getTwilioVoiceCreds();
    const hangup =
      params.hangup ??
      (creds
        ? (callSid: string) =>
            hangupTwilioCall({
              accountSid: creds.sid,
              authToken: creds.token,
              callSid,
            })
        : null);
    if (!hangup) {
      return { ok: false, status: 503, error: "Twilio credentials missing" };
    }
    const ended = await hangup(row.twilio_call_sid);
    if (!ended.ok) {
      return {
        ok: false,
        status: ended.status || 502,
        error: ended.error || "Unable to end the live call",
      };
    }
  }

  const { error: updateError } = await params.supabaseAdmin
    .from("call_sessions")
    .update({
      status: nextStatus,
      ended_at: stale?.ended_at ?? nowIso,
      final_status: nextStatus,
    })
    .eq("id", sessionId);

  if (updateError) {
    return { ok: false, status: 500, error: "Unable to update the call" };
  }

  return { ok: true, status: nextStatus, ringingStopped: true };
}
