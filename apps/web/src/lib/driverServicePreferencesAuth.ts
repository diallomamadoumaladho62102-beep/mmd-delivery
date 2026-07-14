import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function requireDriver(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return { ok: false as const, response: json({ ok: false, error: "missing_token" }, 401) };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!;
  const supabaseServiceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!;

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabaseUser.auth.getUser();
  const user = data?.user;
  if (error || !user?.id) {
    return { ok: false as const, response: json({ ok: false, error: "invalid_token" }, 401) };
  }

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (String(profile?.role ?? "").toLowerCase() !== "driver") {
    return { ok: false as const, response: json({ ok: false, error: "forbidden" }, 403) };
  }

  return {
    ok: true as const,
    userId: user.id,
    supabaseAdmin,
  };
}
