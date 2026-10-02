import type { SupabaseClient } from "@supabase/supabase-js";
import { getTwilioPhoneNumber } from "@/lib/twilioPhone";
import { normalizePhoneE164 } from "@/lib/phoneE164";
import type { DriverIntegrityEntityType } from "./types";

export type VoiceContactResult = {
  ok: boolean;
  callSessionId: string | null;
  result: "initiated" | "failed" | "logged";
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
  if (!callerPhone || !targetPhone || !proxy) {
    return { ok: false, callSessionId: null, result: "failed", error: "phone_unavailable" };
  }

  const expiresAt = new Date(Date.now() + 1000 * 60 * 30).toISOString();
  const { data, error } = await input.supabase
    .from("call_sessions")
    .insert({
      order_id: input.entityId,
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
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false,
      callSessionId: null,
      result: "failed",
      error: error?.message ?? "call_session_failed",
    };
  }

  return {
    ok: true,
    callSessionId: String(data.id),
    result: "initiated",
  };
}

export function voiceContactNeverExposesDriverPhone(): true {
  return true;
}
