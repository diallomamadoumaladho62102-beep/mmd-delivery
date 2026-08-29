import type { SupabaseClient } from "@supabase/supabase-js";

import {
  adminVoiceActionPatch,
  canPerformAdminVoiceAction,
  type AdminVoiceUserAction,
} from "@/lib/adminVoiceCallControl";
import {
  ADMIN_VOICE_CALL_PERMISSION,
  getTwilioVoiceCreds,
  hangupTwilioCall,
  isAdminVoiceCallActive,
  type AdminVoiceActor,
  type AdminVoiceCallRow,
} from "@/lib/adminVoiceTransfer";
import { hasPermission, type StaffRole } from "@/lib/adminRbac";

export function actorCanControlAdminVoice(actor: AdminVoiceActor): boolean {
  if (actor.isFounder) return true;
  const role = actor.role as StaffRole | null;
  if (!role) return false;
  return hasPermission(role, ADMIN_VOICE_CALL_PERMISSION);
}

export async function executeAdminVoiceCallAction(params: {
  actor: AdminVoiceActor;
  callId: string;
  action: AdminVoiceUserAction;
  supabaseAdmin: SupabaseClient;
  hangup?: (callSid: string) => Promise<{ ok: boolean; status: number; error?: string }>;
}): Promise<
  | { ok: true; status: string; ringingStopped: true }
  | { ok: false; status: number; error: string }
> {
  if (!actorCanControlAdminVoice(params.actor)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const action = params.action;
  if (action !== "accept" && action !== "decline" && action !== "end") {
    return { ok: false, status: 400, error: "Invalid call action" };
  }

  const callId = String(params.callId || "").trim();
  if (!callId) {
    return { ok: false, status: 400, error: "callId is required" };
  }

  const { data, error } = await params.supabaseAdmin
    .from("admin_voice_calls")
    .select(
      "id, parent_call_sid, child_call_sid, status, assigned_admin_user_id, current_admin_user_id",
    )
    .eq("id", callId)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 404, error: "Call not found" };
  }

  const call = data as AdminVoiceCallRow;
  if (!isAdminVoiceCallActive(call.status) || !canPerformAdminVoiceAction(action, call.status)) {
    return { ok: false, status: 409, error: "This call is no longer available" };
  }

  const nowIso = new Date().toISOString();
  const patch = adminVoiceActionPatch({
    action,
    actorUserId: params.actor.userId,
    current: call,
    nowIso,
  });
  if (!patch) {
    return { ok: false, status: 409, error: "This call is no longer available" };
  }

  if (action === "decline" || action === "end") {
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

    const sids = [call.parent_call_sid, call.child_call_sid].filter(
      (sid): sid is string => Boolean(sid && String(sid).trim()),
    );
    for (const sid of sids) {
      if (!hangup) {
        return { ok: false, status: 503, error: "Twilio credentials missing" };
      }
      const ended = await hangup(sid);
      if (!ended.ok) {
        return {
          ok: false,
          status: ended.status || 502,
          error: ended.error || "Unable to end the live call",
        };
      }
    }
  }

  const { error: updateError } = await params.supabaseAdmin
    .from("admin_voice_calls")
    .update(patch)
    .eq("id", callId);

  if (updateError) {
    return { ok: false, status: 500, error: "Unable to update the call" };
  }

  return {
    ok: true,
    status: String(patch.status),
    ringingStopped: true,
  };
}

export function parseAdminVoiceCallAction(body: unknown): AdminVoiceUserAction | null {
  if (!body || typeof body !== "object") return null;
  const action = String((body as { action?: unknown }).action ?? "")
    .trim()
    .toLowerCase();
  if (action === "accept" || action === "decline" || action === "end") return action;
  return null;
}
