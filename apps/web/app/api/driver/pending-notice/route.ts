import { NextRequest, NextResponse } from "next/server";
import { notifyReviewersOfPendingSignup } from "@/lib/driverReviewNotifications";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bearer(request: NextRequest): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match?.[1]?.trim() ?? "";
}

export async function POST(request: NextRequest) {
  const token = bearer(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const supabase = buildSupabaseAdminClient();
  const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
  const userId = userRes.user?.id ?? "";
  if (userErr || !userId) {
    return NextResponse.json({ ok: false, error: "not_authenticated" }, { status: 401 });
  }

  const [{ data: profile }, { data: driver }] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
    supabase
      .from("driver_profiles")
      .select("status, full_name")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (String(profile?.role ?? "") !== "driver") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const status = String(driver?.status ?? "");
  if (status !== "pending" && status !== "incomplete") {
    return NextResponse.json({ ok: true, notified: false, reason: "not_pending" });
  }

  const result = await notifyReviewersOfPendingSignup({
    supabaseAdmin: supabase,
    driverUserId: userId,
    driverName: (driver as { full_name?: string | null } | null)?.full_name ?? null,
  });

  return NextResponse.json({
    ok: true,
    notified: result.notified > 0,
    skipped: result.skipped,
  });
}
