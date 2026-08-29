import { NextRequest, NextResponse } from "next/server";

import {
  ADMIN_VOICE_ACTIVE_STATUSES,
  ADMIN_VOICE_CALL_PERMISSION,
  assertEligibleAdminVoiceDestination,
  fetchAdminVoiceStaffProfiles,
  isStaleAdminVoiceCall,
  publicAdminVoiceCallView,
  publicAdminVoiceDestinationView,
  type AdminVoiceCallRow,
} from "@/lib/adminVoiceTransfer";
import { computeAdminVoiceDashboardStats } from "@/lib/adminVoiceIvr";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CALL_SELECT =
  "id, parent_call_sid, from_phone, current_admin_user_id, current_admin_phone, assigned_admin_user_id, ivr_digit, ivr_attempts, service, transfer_count, status, created_at, updated_at";

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission(
      ADMIN_VOICE_CALL_PERMISSION,
      request,
    );
    const supabase = buildSupabaseAdminClient();

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [{ data: recentRaw, error: callsError }, { data: eventsRaw }] =
      await Promise.all([
        supabase
          .from("admin_voice_calls")
          .select(CALL_SELECT)
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("admin_voice_transfer_events")
          .select("id, call_id, from_admin_user_id, to_admin_user_id, service, created_at")
          .order("created_at", { ascending: true })
          .limit(400),
      ]);

    if (callsError) {
      return NextResponse.json(
        { ok: false, error: "Unable to load admin voice calls" },
        { status: 500 },
      );
    }

    const recentSource = (recentRaw ?? []) as AdminVoiceCallRow[];
    const staleIds = recentSource
      .filter((row) => isStaleAdminVoiceCall(row))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      await supabase
        .from("admin_voice_calls")
        .update({
          status: "expired",
          updated_at: new Date().toISOString(),
        })
        .in("id", staleIds);
    }

    const recentCalls = recentSource.map((row) =>
      staleIds.includes(row.id) ? { ...row, status: "expired" } : row,
    );

    const eventsByCall = new Map<
      string,
      Array<{
        id: string;
        fromAdminUserId: string | null;
        toAdminUserId: string | null;
        service: string | null;
        createdAt: string | null;
      }>
    >();
    for (const event of eventsRaw ?? []) {
      const row = event as {
        id: string;
        call_id: string;
        from_admin_user_id: string | null;
        to_admin_user_id: string | null;
        service: string | null;
        created_at: string | null;
      };
      const list = eventsByCall.get(row.call_id) ?? [];
      list.push({
        id: row.id,
        fromAdminUserId: row.from_admin_user_id,
        toAdminUserId: row.to_admin_user_id,
        service: row.service,
        createdAt: row.created_at,
      });
      eventsByCall.set(row.call_id, list);
    }

    const activeCalls = recentCalls
      .filter((row) =>
        (ADMIN_VOICE_ACTIVE_STATUSES as readonly string[]).includes(row.status),
      )
      .map((row) => ({
        ...publicAdminVoiceCallView(row),
        transferHistory: eventsByCall.get(row.id) ?? [],
      }));

    const staffProfiles = await fetchAdminVoiceStaffProfiles(supabase);

    const eligibleAdmins = staffProfiles.filter(
      (profile) => assertEligibleAdminVoiceDestination(profile).ok,
    );

    const destinations = eligibleAdmins
      .filter((profile) => profile.id !== session.userId)
      .map((profile) => {
        const eligible = assertEligibleAdminVoiceDestination(profile);
        if (eligible.ok === false) return null;
        return publicAdminVoiceDestinationView(profile, eligible.phone);
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return NextResponse.json({
      ok: true,
      activeCalls,
      recentCalls: recentCalls.map(publicAdminVoiceCallView),
      destinations,
      authorizedAdminCount: eligibleAdmins.length,
      stats: computeAdminVoiceDashboardStats(recentCalls),
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
