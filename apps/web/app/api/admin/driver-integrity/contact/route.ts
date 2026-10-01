import { NextRequest, NextResponse } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { contactIsActive } from "@/lib/driverIntegrity/engineGate";
import { loadDriverIntegritySettings } from "@/lib/driverIntegrity/settingsStore";
import { sendAdminPush } from "@/lib/adminOutbound";
import { pushText } from "@/lib/pushCopy";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("driver_integrity.read", request);
    const supabase = buildSupabaseAdminClient();
    const url = new URL(request.url);
    const driverId = url.searchParams.get("driver_id");
    const incidentId = url.searchParams.get("incident_id");
    let query = supabase
      .from("driver_integrity_contacts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (driverId) query = query.eq("driver_id", driverId);
    if (incidentId) query = query.eq("incident_id", incidentId);
    const { data, error } = await query;
    if (error) return json({ ok: false, error: "contacts_load_failed" }, 500);
    return json({ ok: true, contacts: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("driver_integrity.manage", request);
    const supabase = buildSupabaseAdminClient();
    const settings = await loadDriverIntegritySettings(supabase);
    if (!contactIsActive(settings)) {
      return json({ ok: false, error: "contact_disabled" }, 403);
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const driverId = String(body.driver_id ?? "").trim();
    const incidentId = String(body.incident_id ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!driverId) return json({ ok: false, error: "driver_required" }, 400);
    if (!reason) return json({ ok: false, error: "reason_required" }, 400);

    const copy = pushText("driver_integrity_admin_contact", "en");
    const pushed = await sendAdminPush({
      userId: driverId,
      title: copy.title,
      body: copy.body,
      role: "driver",
    });

    const { data } = await supabase
      .from("driver_integrity_contacts")
      .insert({
        incident_id: incidentId || null,
        driver_id: driverId,
        admin_user_id: session.userId,
        channel: "push",
        reason,
      })
      .select("id")
      .maybeSingle();

    if (incidentId) {
      await supabase.from("driver_integrity_events").insert({
        incident_id: incidentId,
        event_type: "DRIVER_INTEGRITY_CONTACT",
        payload: { admin_user_id: session.userId, reason, channel: "push" },
      });
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "driver_integrity_contact",
      targetType: "driver",
      targetId: driverId,
      metadata: { incidentId, reason, push: pushed.ok },
      request,
    });

    return json({ ok: true, contact_id: data?.id ?? null, pushed: pushed.ok });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
