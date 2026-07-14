/// <reference types="https://deno.land/x/deno/cli/types/deno.d.ts" />
// @ts-nocheck

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertInternalPushCaller,
  assertPushTargetInContext,
  parseSecurePushBody,
} from "../_shared/securePush.ts";

import { MMD_PUSH_SOUNDS } from "../_shared/mmdPushSounds.ts";
import {
  getEdgeSecretKeyOptional,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-cron-secret",
};

const EXPECTED_ROLE = "driver";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    assertInternalPushCaller(req);
  } catch (authResponse) {
    if (authResponse instanceof Response) return authResponse;
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const pushKey = String(Deno.env.get("PUSH_API_KEY") ?? "").trim();
    const serviceKey = getEdgeSecretKeyOptional();
    let supabaseUrl = "";
    try {
      supabaseUrl = getEdgeSupabaseUrl();
    } catch {
      supabaseUrl = "";
    }

    if (!serviceKey || !supabaseUrl) {
      console.error("[send_driver_push] missing Supabase env");
      return json({ ok: false, error: "Server misconfigured" }, 500);
    }

    if (!pushKey && !String(Deno.env.get("CRON_SECRET") ?? "").trim()) {
      console.error("[send_driver_push] missing PUSH_API_KEY or CRON_SECRET");
      return json({ ok: false, error: "Server misconfigured" }, 500);
    }

    let payload;
    try {
      payload = parseSecurePushBody(await req.json(), EXPECTED_ROLE);
    } catch (e) {
      return json(
        { ok: false, error: e instanceof Error ? e.message : "Invalid payload" },
        400,
      );
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });

    try {
      await assertPushTargetInContext(admin, payload);
    } catch (e) {
      return json(
        {
          ok: false,
          error: e instanceof Error ? e.message : "Forbidden context",
        },
        403,
      );
    }

    const { data: tokens, error: tokenError } = await admin
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", payload.user_id)
      .eq("role", EXPECTED_ROLE);

    if (tokenError) {
      console.error("[send_driver_push] token lookup failed", {
        user_id: payload.user_id,
        message: tokenError.message,
      });
      return json({ ok: false, error: "Token lookup failed" }, 500);
    }

    if (!tokens?.length) {
      return json({ ok: false, error: "No push tokens found" }, 404);
    }

    const messages = tokens.map((tokenRow: { expo_push_token: string }) => ({
      to: tokenRow.expo_push_token,
      sound: MMD_PUSH_SOUNDS.driverRing,
      title: payload.title,
      body: payload.message,
      priority: "high",
      data: payload.data ?? {},
    }));

    const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });

    const expoResult = await expoResponse.json();

    await admin.from("notification_logs").insert({
      user_id: payload.user_id,
      role: EXPECTED_ROLE,
      title: payload.title,
      body: payload.message,
      data: payload.data ?? {},
      status: expoResponse.ok ? "sent" : "failed",
      error_message: expoResponse.ok ? null : JSON.stringify(expoResult),
      sent_at: expoResponse.ok ? new Date().toISOString() : null,
    });

    return json({ ok: true, sent: messages.length, expo: expoResult });
  } catch (error) {
    console.error("[send_driver_push] unhandled", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "Internal server error" }, 500);
  }
});
