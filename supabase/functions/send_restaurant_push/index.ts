/// <reference types="https://deno.land/x/deno/cli/types/deno.d.ts" />
// @ts-nocheck

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { user_id, title, message, data = {}, role = "restaurant" } = body ?? {};

    if (!user_id || !title || !message) {
      return new Response(JSON.stringify({ ok: false, error: "Missing parameters" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const { data: tokens, error: tokenError } = await supabase
      .from("user_push_tokens")
      .select("expo_push_token")
      .eq("user_id", user_id)
      .eq("role", role);

    if (tokenError) throw tokenError;

    if (!tokens?.length) {
      return new Response(JSON.stringify({ ok: false, error: "No push tokens found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages = tokens.map((tokenRow: { expo_push_token: string }) => ({
      to: tokenRow.expo_push_token,
      sound: "default",
      title,
      body: message,
      priority: "high",
      data,
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

    await supabase.from("notification_logs").insert({
      user_id,
      role,
      title,
      body: message,
      data,
      status: expoResponse.ok ? "sent" : "failed",
      error_message: expoResponse.ok ? null : JSON.stringify(expoResult),
      sent_at: expoResponse.ok ? new Date().toISOString() : null,
    });

    return new Response(JSON.stringify({ ok: true, expo: expoResult }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(error);

    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});