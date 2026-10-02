import { NextRequest, NextResponse } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { contactIsActive } from "@/lib/driverIntegrity/engineGate";
import { loadDriverIntegritySettings } from "@/lib/driverIntegrity/settingsStore";
import { startMaskedAdminDriverCall } from "@/lib/driverIntegrity/voiceContact";
import { sendAdminPush } from "@/lib/adminOutbound";
import { pushText } from "@/lib/pushCopy";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  DRIVER_INTEGRITY_ENTITY_TYPES,
  type DriverIntegrityEntityType,
} from "@/lib/driverIntegrity/types";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function parseEntityType(value: unknown): DriverIntegrityEntityType | null {
  const raw = String(value ?? "").trim();
  if ((DRIVER_INTEGRITY_ENTITY_TYPES as readonly string[]).includes(raw)) {
    return raw as DriverIntegrityEntityType;
  }
  return null;
}

function publicContact(row: Record<string, unknown>) {
  return {
    id: row.id,
    created_at: row.created_at,
    channel: row.channel,
    result: row.result ?? null,
    reason: row.reason ?? null,
    admin_user_id: row.admin_user_id,
    driver_id: row.driver_id,
    incident_id: row.incident_id,
    entity_type: row.entity_type ?? null,
    entity_id: row.entity_id ?? null,
    call_session_id: row.call_session_id ?? null,
  };
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
      .select(
        "id,created_at,channel,result,reason,admin_user_id,driver_id,incident_id,entity_type,entity_id,call_session_id"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (driverId) query = query.eq("driver_id", driverId);
    if (incidentId) query = query.eq("incident_id", incidentId);
    const { data, error } = await query;
    if (error) return json({ ok: false, error: "contacts_load_failed" }, 500);
    return json({
      ok: true,
      contacts: (data ?? []).map((row) => publicContact(row as Record<string, unknown>)),
    });
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
    const channel = String(body.channel ?? "push").trim().toLowerCase() === "voice"
      ? "voice"
      : "push";
    let entityType = parseEntityType(body.entity_type);
    let entityId = String(body.entity_id ?? "").trim() || null;

    if (!driverId) return json({ ok: false, error: "driver_required" }, 400);
    if (!reason) return json({ ok: false, error: "reason_required" }, 400);

    if (incidentId && (!entityType || !entityId)) {
      const { data: incident } = await supabase
        .from("driver_integrity_incidents")
        .select("entity_type,entity_id,original_driver_id")
        .eq("id", incidentId)
        .maybeSingle();
      if (incident) {
        entityType = parseEntityType(incident.entity_type) ?? entityType;
        entityId = String(incident.entity_id ?? "") || entityId;
        if (String(incident.original_driver_id ?? "") && String(incident.original_driver_id) !== driverId) {
          return json({ ok: false, error: "driver_mismatch" }, 403);
        }
      }
    }

    let pushed = false;
    let voice: {
      callSessionId: string | null;
      result: string;
      error?: string;
      proxyNumber: string | null;
    } = {
      callSessionId: null,
      result: "logged",
      proxyNumber: null,
    };

    if (channel === "push") {
      const copy = pushText("driver_integrity_admin_contact", "en");
      const sent = await sendAdminPush({
        userId: driverId,
        title: copy.title,
        body: copy.body,
        role: "driver",
      });
      pushed = sent.ok;
    } else {
      const started = await startMaskedAdminDriverCall({
        supabase,
        adminUserId: session.userId,
        driverId,
        entityType,
        entityId,
      });
      voice = {
        callSessionId: started.callSessionId,
        result: started.result,
        error: started.error,
        proxyNumber: started.proxyNumber,
      };
      if (!started.ok) {
        await writeAdminAuditServer({
          supabaseAdmin: supabase,
          adminUserId: session.userId,
          action: "driver_integrity_contact",
          targetType: "driver",
          targetId: driverId,
          metadata: {
            incidentId,
            reason,
            channel,
            voice_result: started.result,
            error: started.error,
          },
          request,
        });
        return json(
          {
            ok: false,
            error: started.error ?? "voice_failed",
            channel,
            voice_result: started.result,
            call_session_id: started.callSessionId,
            proxy_number: null,
            driver_phone_exposed: false,
          },
          409
        );
      }
    }

    const { data } = await supabase
      .from("driver_integrity_contacts")
      .insert({
        incident_id: incidentId || null,
        driver_id: driverId,
        admin_user_id: session.userId,
        channel,
        reason,
        result: channel === "voice" ? voice.result : pushed ? "sent" : "failed",
        call_session_id: voice.callSessionId,
        entity_type: entityType,
        entity_id: entityId,
      })
      .select("id")
      .maybeSingle();

    if (incidentId) {
      await supabase.from("driver_integrity_events").insert({
        incident_id: incidentId,
        event_type: "DRIVER_INTEGRITY_CONTACT",
        payload: {
          admin_user_id: session.userId,
          reason,
          channel,
          result: channel === "voice" ? voice.result : pushed ? "sent" : "failed",
          call_session_id: voice.callSessionId,
        },
      });
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "driver_integrity_contact",
      targetType: "driver",
      targetId: driverId,
      metadata: {
        incidentId,
        reason,
        channel,
        push: pushed,
        voice_result: voice.result,
        call_session_id: voice.callSessionId,
      },
      request,
    });

    return json({
      ok: true,
      contact_id: data?.id ?? null,
      channel,
      pushed,
      voice_result: voice.result,
      call_session_id: voice.callSessionId,
      proxy_number: voice.proxyNumber,
      driver_phone_exposed: false,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
