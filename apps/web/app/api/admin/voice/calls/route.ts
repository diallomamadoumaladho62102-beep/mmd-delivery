import { NextRequest, NextResponse } from "next/server";

import {
  ADMIN_VOICE_ACTIVE_STATUSES,
  ADMIN_VOICE_CALL_PERMISSION,
  assertEligibleAdminVoiceDestination,
  publicAdminVoiceCallView,
  publicAdminVoiceDestinationView,
  type AdminVoiceCallRow,
  type AdminVoiceDestinationProfile,
} from "@/lib/adminVoiceTransfer";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission(
      ADMIN_VOICE_CALL_PERMISSION,
      request,
    );
    const supabase = buildSupabaseAdminClient();

    const { data: callsRaw, error: callsError } = await supabase
      .from("admin_voice_calls")
      .select(
        "id, parent_call_sid, from_phone, current_admin_user_id, current_admin_phone, status, created_at",
      )
      .in("status", [...ADMIN_VOICE_ACTIVE_STATUSES])
      .order("created_at", { ascending: false })
      .limit(50);

    if (callsError) {
      return NextResponse.json(
        { ok: false, error: "Unable to load admin voice calls" },
        { status: 500 },
      );
    }

    const staffSelect =
      "id, full_name, email, role, is_founder, phone, account_status";
    const [{ data: founderRaw, error: founderError }, { data: staffRaw, error: staffError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select(staffSelect)
          .eq("is_founder", true)
          .limit(20),
        supabase
          .from("profiles")
          .select(staffSelect)
          .in("role", [
            "super_admin",
            "admin",
            "operations_admin",
            "ops",
            "support_admin",
            "support",
          ])
          .limit(100),
      ]);

    if (founderError || staffError) {
      return NextResponse.json(
        { ok: false, error: "Unable to load transfer destinations" },
        { status: 500 },
      );
    }

    const staffById = new Map<string, AdminVoiceDestinationProfile>();
    for (const profile of [
      ...((founderRaw ?? []) as AdminVoiceDestinationProfile[]),
      ...((staffRaw ?? []) as AdminVoiceDestinationProfile[]),
    ]) {
      staffById.set(profile.id, profile);
    }

    const destinations = Array.from(staffById.values())
      .map((profile) => {
        const eligible = assertEligibleAdminVoiceDestination(profile);
        if (eligible.ok === false) return null;
        if (profile.id === session.userId) return null;
        return publicAdminVoiceDestinationView(profile, eligible.phone);
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return NextResponse.json({
      ok: true,
      activeCalls: ((callsRaw ?? []) as AdminVoiceCallRow[]).map(
        publicAdminVoiceCallView,
      ),
      destinations,
    });
  } catch (error) {
    const status = error instanceof AdminAccessError ? error.status : 500;
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Server error",
      },
      { status },
    );
  }
}
