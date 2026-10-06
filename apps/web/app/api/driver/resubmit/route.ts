import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { notifyReviewersOfResubmit } from "@/lib/driverReviewNotifications";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/lib/supabaseEnv";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (String(profile?.role ?? "") !== "driver") {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const userClient = createClient(getSupabaseUrl(), getSupabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.rpc("resubmit_driver_application");
  if (error) {
    console.error("[driverReview] resubmit rpc failed", error.message);
    return NextResponse.json({ ok: false, error: "resubmit_unavailable" }, { status: 503 });
  }

  const payload = (data ?? null) as { ok?: boolean; error?: string; status?: string } | null;
  if (!payload?.ok) {
    return NextResponse.json(
      { ok: false, error: payload?.error === "review_conflict" ? "review_conflict" : "review_conflict" },
      { status: 409 },
    );
  }

  const { data: driver } = await supabase
    .from("driver_profiles")
    .select("full_name, updated_at, status")
    .eq("user_id", userId)
    .maybeSingle();

  const updatedAt = String(
    (driver as { updated_at?: string | null } | null)?.updated_at ?? new Date().toISOString(),
  );

  await writeAdminAuditServer({
    supabaseAdmin: supabase,
    adminUserId: userId,
    action: "driver_resubmitted",
    targetType: "driver",
    targetId: userId,
    oldValues: { status: "rejected" },
    newValues: { status: "pending" },
    metadata: { updated_at: updatedAt },
    request,
  });

  const notice = await notifyReviewersOfResubmit({
    supabaseAdmin: supabase,
    driverUserId: userId,
    driverName: (driver as { full_name?: string | null } | null)?.full_name ?? null,
    updatedAt,
  });

  return NextResponse.json({
    ok: true,
    status: "pending",
    notified: notice.notified > 0,
  });
}
