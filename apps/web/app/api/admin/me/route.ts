import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertAdminAccess,
  resolveAdminSession,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertAdminAccess(request);
    const session = await resolveAdminSession(request);
    const supabase = buildSupabaseAdminClient();

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_founder")
      .eq("id", session.userId)
      .maybeSingle();

    return json({
      ok: true,
      userId: session.userId,
      role: session.role,
      accountStatus: session.accountStatus,
      isFounder: Boolean(profile?.is_founder),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Unauthorized" },
      status
    );
  }
}
