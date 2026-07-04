import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function GET(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) return json({ ok: false, error: "missing_token" }, 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabaseUser.auth.getUser();
  const userId = data?.user?.id;
  if (error || !userId) return json({ ok: false, error: "invalid_token" }, 401);

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "pending";

  const { data: jobs, error: jobsError } = await supabaseAdmin
    .from("restaurant_print_jobs")
    .select("*")
    .eq("restaurant_user_id", userId)
    .eq("status", status)
    .order("created_at", { ascending: true })
    .limit(20);

  if (jobsError) return json({ ok: false, error: jobsError.message }, 500);
  return json({ ok: true, jobs: jobs ?? [] });
}

export async function PATCH(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) return json({ ok: false, error: "missing_token" }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const jobId = String(body.job_id ?? "").trim();
  const status = String(body.status ?? "").trim().toLowerCase();
  const errorMessage = String(body.error_message ?? "").trim() || null;

  if (!jobId || !["printing", "printed", "failed"].includes(status)) {
    return json({ ok: false, error: "invalid_payload" }, 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabaseUser.auth.getUser();
  const userId = data?.user?.id;
  if (error || !userId) return json({ ok: false, error: "invalid_token" }, 401);

  const patch: Record<string, unknown> = { status };
  if (status === "printed") patch.printed_at = new Date().toISOString();
  if (status === "failed") patch.error_message = errorMessage ?? "print_failed";

  const { data: job, error: updateError } = await supabaseAdmin
    .from("restaurant_print_jobs")
    .update(patch)
    .eq("id", jobId)
    .eq("restaurant_user_id", userId)
    .select("*")
    .maybeSingle();

  if (updateError) return json({ ok: false, error: updateError.message }, 500);
  if (!job) return json({ ok: false, error: "not_found" }, 404);

  return json({ ok: true, job });
}
