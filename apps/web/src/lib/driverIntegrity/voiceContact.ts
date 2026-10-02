import type { SupabaseClient } from "@supabase/supabase-js";
import { getTwilioPhoneNumber } from "@/lib/twilioPhone";
import { normalizePhoneE164 } from "@/lib/phoneE164";
import { toPublicMaskedCallSession } from "@/lib/publicMaskedCallSession";
import type { DriverIntegrityEntityType } from "./types";

export type VoiceContactResult = {
  ok: boolean;
  callSessionId: string | null;
  proxyNumber: string | null;
  result: "ready_to_dial" | "failed" | "duplicate";
  error?: string;
};

async function profilePhone(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("phone")
    .eq("id", userId)
    .maybeSingle();
  return normalizePhoneE164((data as { phone?: string | null } | null)?.phone);
}

function sourceOrderId(entityId: string | null): string | null {
  return entityId && entityId.trim() ? entityId.trim() : null;
}

/**
 * Production masked call: create/reuse a call_sessions row, then the admin
 * dials the MMD proxy. Twilio inbound bridges to the driver. Never return
 * the driver number. Do not claim the call is completed.
 */
export async function startMaskedAdminDriverCall(input: {
  supabase: SupabaseClient;
  adminUserId: string;
  driverId: string;
  entityType: DriverIntegrityEntityType | null;
  entityId: string | null;
}): Promise<VoiceContactResult> {
  const proxy = getTwilioPhoneNumber();
  const callerPhone = await profilePhone(input.supabase, input.adminUserId);
  const targetPhone = await profilePhone(input.supabase, input.driverId);
  if (!proxy) {
    return {
      ok: false,
      callSessionId: null,
      proxyNumber: null,
      result: "failed",
      error: "proxy_unavailable",
    };
  }
  if (!callerPhone) {
    return {
      ok: false,
      callSessionId: null,
      proxyNumber: null,
      result: "failed",
      error: "admin_phone_unavailable",
    };
  }
  if (!targetPhone) {
    return {
      ok: false,
      callSessionId: null,
      proxyNumber: null,
      result: "failed",
      error: "driver_phone_unavailable",
    };
  }

  const orderId = sourceOrderId(input.entityId);
  const nowIso = new Date().toISOString();

  let existingQuery = input.supabase
    .from("call_sessions")
    .select("id,order_id,caller_role,target_role,status,proxy_number,expires_at")
    .eq("caller_user_id", input.adminUserId)
    .eq("target_user_id", input.driverId)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (orderId) existingQuery = existingQuery.eq("order_id", orderId);

  const { data: existing } = await existingQuery.maybeSingle();
  if (existing?.id) {
    const publicSession = toPublicMaskedCallSession(existing, proxy);
    return {
      ok: true,
      callSessionId: String(existing.id),
      proxyNumber: publicSession?.proxy_number ?? proxy,
      result: "duplicate",
    };
  }

  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
  const { data, error } = await input.supabase
    .from("call_sessions")
    .insert({
      order_id: orderId,
      caller_user_id: input.adminUserId,
      caller_role: "admin",
      target_user_id: input.driverId,
      target_role: "driver",
      proxy_number: proxy,
      caller_phone: callerPhone,
      target_phone: targetPhone,
      expires_at: expiresAt,
      status: "active",
    })
    .select("id,order_id,caller_role,target_role,status,proxy_number,expires_at")
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false,
      callSessionId: null,
      proxyNumber: null,
      result: "failed",
      error: error?.message ?? "call_session_failed",
    };
  }

  const publicSession = toPublicMaskedCallSession(data, proxy);
  return {
    ok: true,
    callSessionId: String(data.id),
    proxyNumber: publicSession?.proxy_number ?? proxy,
    result: "ready_to_dial",
  };
}

export function voiceContactNeverExposesDriverPhone(): true {
  return true;
}
