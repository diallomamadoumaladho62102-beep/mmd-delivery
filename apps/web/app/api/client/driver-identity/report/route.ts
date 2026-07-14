import { NextRequest } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { evaluateDriverIdentity } from "@/lib/driverIdentityService";
import { hashIp } from "@/lib/driverIdentityRiskEngine";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(req: NextRequest): string {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) return clientJson({ ok: false, error: "missing_token" }, 401);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabaseUrl || !supabaseAnonKey) {
    return clientJson({ ok: false, error: "server_misconfigured" }, 500);
  }

  const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: authData, error: authError } = await supabaseUser.auth.getUser();
  const reporterId = authData?.user?.id;
  if (authError || !reporterId) return clientJson({ ok: false, error: "invalid_token" }, 401);

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const driverId = String(body.driver_id ?? "").trim();
  const reason = String(body.reason ?? "Client identity concern").trim();
  const orderId = String(body.order_id ?? "").trim() || null;

  if (!driverId) return clientJson({ ok: false, error: "driver_id_required" }, 400);

  const admin = buildSupabaseAdminClient();

  const { data: report, error } = await admin
    .from("driver_identity_reports")
    .insert({
      driver_id: driverId,
      reporter_user_id: reporterId,
      order_id: orderId,
      reason,
      status: "open",
    })
    .select("*")
    .single();

  if (error) return clientJson({ ok: false, error: error.message }, 500);

  await admin.from("driver_identity_events").insert({
    driver_id: driverId,
    event_type: "client_report_received",
    metadata: { report_id: report.id, order_id: orderId, reason },
  });

  await evaluateDriverIdentity(admin, {
    driverId,
    intent: "go_online",
    ipHash: hashIp(req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null),
  });

  return clientJson({ ok: true, report_id: report.id });
}
