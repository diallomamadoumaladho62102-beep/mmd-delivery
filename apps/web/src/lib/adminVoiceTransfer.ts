import type { SupabaseClient } from "@supabase/supabase-js";

import type { UserRole } from "@/lib/roles";
import { isAccountActive } from "@/lib/accountStatus";
import {
  effectiveStaffRole,
  hasPermission,
  type StaffRole,
} from "@/lib/adminRbac";
import { maskPhone, normalizePhoneE164, phonesEquivalent } from "@/lib/phoneE164";
import { getTwilioPhoneNumber } from "@/lib/twilioPhone";
import { getTwilioVoiceStatusCallbackUrl } from "@/lib/twilioProductionUrls";

export const ADMIN_VOICE_CALL_PERMISSION = "communication.calls" as const;

export const ADMIN_VOICE_ACTIVE_STATUSES = [
  "ringing",
  "in_progress",
  "transferred",
] as const;

export const ADMIN_VOICE_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "canceled",
  "missed",
] as const;

const SENSITIVE_LOG_KEY = /token|secret|authorization|password|auth/i;

export type AdminVoiceActor = {
  userId: string;
  role: UserRole;
  isFounder: boolean;
};

export type AdminVoiceCallRow = {
  id: string;
  parent_call_sid: string;
  child_call_sid?: string | null;
  from_phone: string | null;
  current_admin_user_id: string | null;
  current_admin_phone: string;
  transferred_from_user_id?: string | null;
  transferred_to_user_id?: string | null;
  status: string;
  created_at?: string | null;
};

export type AdminVoiceDestinationProfile = {
  id: string;
  full_name?: string | null;
  email?: string | null;
  role: unknown;
  is_founder?: boolean | null;
  phone?: string | null;
  account_status?: string | null;
};

export type AdminVoiceTransferResult =
  | { ok: true; callId: string; destinationUserId: string }
  | { ok: false; status: number; error: string };

export type AdminVoiceTransferDeps = {
  loadCall: (callId: string) => Promise<AdminVoiceCallRow | null>;
  loadDestination: (
    userId: string,
  ) => Promise<AdminVoiceDestinationProfile | null>;
  updateCall: (
    callId: string,
    patch: Record<string, unknown>,
  ) => Promise<void>;
  redirectCall: (params: {
    callSid: string;
    twiml: string;
  }) => Promise<{ ok: boolean; status: number; error?: string }>;
};

export function escapeTwiml(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function getAdminSupportPhone(): string {
  return String(process.env.MMD_ADMIN_SUPPORT_PHONE || "+19297408722").trim();
}

export function getPublicVoiceCallerId(): string {
  return getTwilioPhoneNumber();
}

export function actorCanTransferAdminVoice(actor: AdminVoiceActor): boolean {
  if (actor.isFounder) return true;
  if (!actor.role) return false;
  return hasPermission(actor.role, ADMIN_VOICE_CALL_PERMISSION);
}

export function canReceiveAdminVoiceCalls(
  role: UserRole | null,
  isFounder = false,
): boolean {
  if (isFounder) return true;
  if (!role) return false;
  return hasPermission(role, ADMIN_VOICE_CALL_PERMISSION);
}

export function resolveIncomingVoiceRoute(params: {
  hasFrom: boolean;
  matchedSession: boolean;
}): "masked" | "support" {
  if (params.hasFrom && params.matchedSession) return "masked";
  return "support";
}

export function isAdminVoiceCallActive(status: string | null | undefined): boolean {
  const normalized = String(status ?? "").trim().toLowerCase();
  return (ADMIN_VOICE_ACTIVE_STATUSES as readonly string[]).includes(normalized);
}

export function parseTransferRequest(body: unknown): {
  ok: true;
  callId: string;
  destinationUserId: string;
} | {
  ok: false;
  status: number;
  error: string;
} {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Invalid transfer payload" };
  }

  const record = body as Record<string, unknown>;
  const callId = String(record.callId ?? record.call_id ?? "").trim();
  const destinationUserId = String(
    record.destinationUserId ?? record.destination_user_id ?? "",
  ).trim();
  const destinationPhone = String(
    record.destinationPhone ?? record.destination_phone ?? "",
  ).trim();

  if (destinationPhone && !destinationUserId) {
    return {
      ok: false,
      status: 400,
      error: "Transfer destination must be an authorized admin user",
    };
  }

  if (!callId || !destinationUserId) {
    return { ok: false, status: 400, error: "callId and destinationUserId are required" };
  }

  return { ok: true, callId, destinationUserId };
}

export function assertEligibleAdminVoiceDestination(
  profile: AdminVoiceDestinationProfile | null,
): { ok: true; phone: string; role: StaffRole } | { ok: false; status: number; error: string } {
  if (!profile) {
    return { ok: false, status: 404, error: "Destination admin was not found" };
  }

  if (!isAccountActive(profile.account_status)) {
    return { ok: false, status: 403, error: "Destination admin is not allowed to receive calls" };
  }

  const role = effectiveStaffRole({
    role: profile.role,
    isFounder: profile.is_founder === true,
  });

  if (!role || !canReceiveAdminVoiceCalls(role, profile.is_founder === true)) {
    return { ok: false, status: 403, error: "Destination is not authorized to receive admin calls" };
  }

  const phone = normalizePhoneE164(profile.phone);
  if (!phone) {
    return { ok: false, status: 409, error: "Destination admin has no valid phone number" };
  }

  return { ok: true, phone, role };
}

export function buildAdminDialTwiml(params: {
  destPhone: string;
  callerId?: string;
  includeWelcome?: boolean;
}): string {
  const destPhone = normalizePhoneE164(params.destPhone) || "";
  const callerId = normalizePhoneE164(params.callerId) || getPublicVoiceCallerId();
  const statusCallbackUrl = getTwilioVoiceStatusCallbackUrl();
  const welcome = params.includeWelcome
    ? `
  <Say voice="alice" language="en-US">
    Welcome to MMD Delivery and Ride support.
    Thank you for calling us.
    For safety and quality purposes, this call may be recorded.
    Please wait while we connect you to our support team.
  </Say>
`
    : `
  <Say voice="alice" language="en-US">
    Please wait while we transfer your call.
  </Say>
`;

  return `
<?xml version="1.0" encoding="UTF-8"?>
<Response>
${welcome}
  <Dial
    callerId="${escapeTwiml(callerId)}"
    answerOnBridge="true"
    timeout="25"
    record="record-from-answer-dual"
    statusCallback="${escapeTwiml(statusCallbackUrl)}"
    statusCallbackEvent="initiated ringing answered completed"
    statusCallbackMethod="POST"
  >
    <Number>${escapeTwiml(destPhone)}</Number>
  </Dial>

  <Say voice="alice" language="en-US">
    Our support team is not available right now.
    Please leave your name, phone number, order or trip details, and a short message after the beep.
  </Say>

  <Record
    maxLength="180"
    playBeep="true"
    transcribe="false"
    trim="trim-silence"
  />

  <Say voice="alice" language="en-US">
    Thank you for calling MMD Delivery and Ride.
    We appreciate your trust. Goodbye.
  </Say>
</Response>
  `.trim();
}

export function buildInboundAdminVoiceCallRow(params: {
  callSid: string;
  fromPhone: string | null;
  supportPhone?: string;
  nowIso: string;
}): Record<string, unknown> | null {
  const parentCallSid = String(params.callSid || "").trim();
  if (!parentCallSid) return null;

  return {
    parent_call_sid: parentCallSid,
    from_phone: normalizePhoneE164(params.fromPhone),
    current_admin_phone: normalizePhoneE164(params.supportPhone) || getAdminSupportPhone(),
    status: "ringing",
    updated_at: params.nowIso,
  };
}

export function mapTwilioStatusToAdminVoice(
  twilioStatus: string,
  currentStatus: string | null | undefined,
): string | null {
  const incoming = String(twilioStatus || "").trim().toLowerCase();
  const current = String(currentStatus || "").trim().toLowerCase();

  let next: string | null = null;
  if (["queued", "initiated", "ringing"].includes(incoming)) next = "ringing";
  else if (["in-progress", "answered"].includes(incoming)) next = "in_progress";
  else if (incoming === "completed") next = "completed";
  else if (incoming === "busy" || incoming === "no-answer") next = "missed";
  else if (incoming === "failed") next = "failed";
  else if (incoming === "canceled") next = "canceled";

  if (!next) return null;

  if ((ADMIN_VOICE_TERMINAL_STATUSES as readonly string[]).includes(current)) {
    return current === next ? next : null;
  }

  if (current === "transferred" && (next === "ringing" || next === "in_progress")) {
    return "transferred";
  }

  return next;
}

export function redactAdminVoiceLog(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") {
    const normalized = normalizePhoneE164(value);
    if (normalized && value.includes(normalized.slice(-4))) {
      return maskPhone(value);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(redactAdminVoiceLog);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_LOG_KEY.test(key) || key.toLowerCase() === "twiml") {
        out[key] = "[redacted]";
        continue;
      }
      out[key] = redactAdminVoiceLog(nested);
    }
    return out;
  }
  return value;
}

export function publicAdminVoiceCallView(row: AdminVoiceCallRow) {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at ?? null,
    fromPhone: row.from_phone,
    currentAdminUserId: row.current_admin_user_id,
    parentCallSid: row.parent_call_sid,
  };
}

export function publicAdminVoiceDestinationView(
  profile: AdminVoiceDestinationProfile,
  phone: string,
) {
  const role = effectiveStaffRole({
    role: profile.role,
    isFounder: profile.is_founder === true,
  });

  return {
    userId: profile.id,
    fullName: profile.full_name || profile.email || "Admin",
    role,
    phoneLast4: maskPhone(phone),
  };
}

export function getTwilioVoiceCreds(): { sid: string; token: string } | null {
  const sid = String(process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = String(
    process.env.TWILIO_AUTH_TOKEN ?? process.env.TWILIO_AUTH_TOKEN_SECRET ?? "",
  ).trim();
  if (!sid || !token) return null;
  return { sid, token };
}

export function buildTwilioCallUpdateUrl(accountSid: string, callSid: string): string {
  return `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls/${callSid}.json`;
}

export async function redirectTwilioParentCall(params: {
  accountSid: string;
  authToken: string;
  callSid: string;
  twiml: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const auth = Buffer.from(`${params.accountSid}:${params.authToken}`).toString("base64");
  const url = buildTwilioCallUpdateUrl(params.accountSid, params.callSid);
  const body = new URLSearchParams({ Twiml: params.twiml });

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!response.ok) {
    return {
      ok: false,
      status: response.status >= 400 && response.status < 600 ? 502 : 500,
      error: "Unable to redirect the live call",
    };
  }

  return { ok: true, status: 200 };
}

export async function executeAdminVoiceTransfer(params: {
  actor: AdminVoiceActor;
  callId: string;
  destinationUserId: string;
  deps: AdminVoiceTransferDeps;
}): Promise<AdminVoiceTransferResult> {
  if (!actorCanTransferAdminVoice(params.actor)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const callId = String(params.callId || "").trim();
  const destinationUserId = String(params.destinationUserId || "").trim();
  if (!callId || !destinationUserId) {
    return { ok: false, status: 400, error: "callId and destinationUserId are required" };
  }

  const call = await params.deps.loadCall(callId);
  if (!call) {
    return { ok: false, status: 404, error: "No valid admin call session was found" };
  }

  if (!isAdminVoiceCallActive(call.status)) {
    return { ok: false, status: 409, error: "This call is no longer active" };
  }

  if (!String(call.parent_call_sid || "").trim()) {
    return { ok: false, status: 409, error: "This call is no longer active" };
  }

  if (destinationUserId === params.actor.userId) {
    return { ok: false, status: 409, error: "Select a different authorized admin" };
  }

  const destination = await params.deps.loadDestination(destinationUserId);
  const eligible = assertEligibleAdminVoiceDestination(destination);
  if (eligible.ok === false) return eligible;

  if (phonesEquivalent(eligible.phone, call.current_admin_phone)) {
    return { ok: false, status: 409, error: "Select a different authorized admin" };
  }

  const twiml = buildAdminDialTwiml({
    destPhone: eligible.phone,
    callerId: getPublicVoiceCallerId(),
    includeWelcome: false,
  });

  const previous = {
    current_admin_user_id: call.current_admin_user_id,
    current_admin_phone: call.current_admin_phone,
    status: call.status,
    transferred_from_user_id: call.transferred_from_user_id ?? null,
    transferred_to_user_id: call.transferred_to_user_id ?? null,
  };

  await params.deps.updateCall(call.id, {
    current_admin_user_id: destinationUserId,
    current_admin_phone: eligible.phone,
    transferred_from_user_id: params.actor.userId,
    transferred_to_user_id: destinationUserId,
    status: "transferred",
    updated_at: new Date().toISOString(),
  });

  const redirected = await params.deps.redirectCall({
    callSid: call.parent_call_sid,
    twiml,
  });

  if (!redirected.ok) {
    await params.deps.updateCall(call.id, {
      ...previous,
      updated_at: new Date().toISOString(),
    });
    return {
      ok: false,
      status: redirected.status || 502,
      error: redirected.error || "Unable to transfer this call",
    };
  }

  return { ok: true, callId: call.id, destinationUserId };
}

export async function applyAdminVoiceStatusCallback(params: {
  supabaseAdmin: SupabaseClient;
  callSid: string;
  dialCallSid?: string | null;
  callStatus: string;
}): Promise<{ callId: string | null; status: string | null }> {
  const callSid = String(params.callSid || "").trim();
  const dialCallSid = String(params.dialCallSid || "").trim();
  const candidates = [callSid, dialCallSid].filter((sid) => sid.length > 0);
  if (candidates.length === 0) {
    return { callId: null, status: null };
  }

  let row:
    | {
        id?: string;
        status?: string | null;
        child_call_sid?: string | null;
      }
    | null = null;

  for (const sid of candidates) {
    const byParent = await params.supabaseAdmin
      .from("admin_voice_calls")
      .select("id, parent_call_sid, child_call_sid, status")
      .eq("parent_call_sid", sid)
      .maybeSingle();
    if (byParent.data) {
      row = byParent.data;
      break;
    }

    const byChild = await params.supabaseAdmin
      .from("admin_voice_calls")
      .select("id, parent_call_sid, child_call_sid, status")
      .eq("child_call_sid", sid)
      .maybeSingle();
    if (byChild.data) {
      row = byChild.data;
      break;
    }
  }

  if (!row?.id) {
    return { callId: null, status: null };
  }

  const nextStatus = mapTwilioStatusToAdminVoice(params.callStatus, row.status);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (dialCallSid && !row.child_call_sid) {
    patch.child_call_sid = dialCallSid;
  }

  if (nextStatus) {
    patch.status = nextStatus;
  }

  if (patch.status || patch.child_call_sid) {
    await params.supabaseAdmin
      .from("admin_voice_calls")
      .update(patch)
      .eq("id", row.id);
  }

  return { callId: row.id, status: nextStatus ?? row.status ?? null };
}
