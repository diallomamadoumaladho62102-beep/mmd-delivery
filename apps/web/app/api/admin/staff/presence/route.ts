import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("hub.access", request);
    const body = (await request.json().catch(() => ({}))) as {
      status?: string;
    };
    const status = ["online", "away", "busy", "offline"].includes(
      String(body.status)
    )
      ? String(body.status)
      : "online";

    const supabase = buildSupabaseAdminClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        last_seen_at: new Date().toISOString(),
        presence_status: status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.userId);

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          pending_migration: error.message.includes("presence_status"),
        },
        { status: error.message.includes("presence_status") ? 503 : 500 }
      );
    }

    return NextResponse.json({ ok: true, status });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status }
    );
  }
}
