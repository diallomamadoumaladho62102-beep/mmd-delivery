import { NextRequest, NextResponse } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  applyPolicyAction,
  applyReviewDecision,
  canTransitionIncident,
} from "@/lib/driverIntegrity/reviewPolicy";
import { loadDriverIntegritySettings } from "@/lib/driverIntegrity/settingsStore";
import type {
  DriverIntegrityIncidentStatus,
  DriverIntegrityPolicyAction,
  DriverIntegrityReviewDecision,
} from "@/lib/driverIntegrity/types";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("driver_integrity.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("driver_integrity_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return json({ ok: false, error: "reviews_load_failed" }, 500);
    return json({ ok: true, reviews: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("driver_integrity.review", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const incidentId = String(body.incident_id ?? "").trim();
    const action = String(body.action ?? "").trim();
    const notes = String(body.notes ?? "").trim();
    if (!incidentId) return json({ ok: false, error: "incident_required" }, 400);

    const { data: incident } = await supabase
      .from("driver_integrity_incidents")
      .select("*")
      .eq("id", incidentId)
      .maybeSingle();
    if (!incident) return json({ ok: false, error: "incident_not_found" }, 404);

    const current = String(incident.status) as DriverIntegrityIncidentStatus;
    const settings = await loadDriverIntegritySettings(supabase);

    if (action === "open_review") {
      if (!canTransitionIncident(current, "review")) {
        return json({ ok: false, error: "invalid_transition" }, 400);
      }
      await supabase
        .from("driver_integrity_incidents")
        .update({
          status: "review",
          review_opened_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", incidentId);
      await supabase.from("driver_integrity_reviews").upsert(
        { incident_id: incidentId, status: "open" },
        { onConflict: "incident_id" }
      );
      await supabase.from("driver_integrity_events").insert({
        incident_id: incidentId,
        event_type: "DRIVER_INTEGRITY_REVIEW_OPENED",
        payload: { admin_user_id: session.userId },
      });
      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "driver_integrity_review_opened",
        targetType: "driver_integrity_incident",
        targetId: incidentId,
        request,
      });
      return json({ ok: true, status: "review" });
    }

    if (action === "confirm" || action === "not_confirm") {
      const decision: DriverIntegrityReviewDecision =
        action === "confirm" ? "confirmed" : "not_confirmed";
      const next = applyReviewDecision({ current, decision });
      if (next.ok === false) return json({ ok: false, error: next.reason }, 400);
      await supabase
        .from("driver_integrity_incidents")
        .update({
          status: next.next,
          review_decision: decision,
          review_decided_at: new Date().toISOString(),
          review_decided_by: session.userId,
          review_notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", incidentId);
      await supabase
        .from("driver_integrity_reviews")
        .update({
          status: decision,
          decision_notes: notes || null,
          decided_by: session.userId,
          decided_at: new Date().toISOString(),
        })
        .eq("incident_id", incidentId);
      await supabase.from("driver_integrity_events").insert({
        incident_id: incidentId,
        event_type:
          decision === "confirmed"
            ? "DRIVER_INTEGRITY_CONFIRMED"
            : "DRIVER_INTEGRITY_NOT_CONFIRMED",
        payload: { admin_user_id: session.userId, notes },
      });
      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: `driver_integrity_${decision}`,
        targetType: "driver_integrity_incident",
        targetId: incidentId,
        metadata: { notes },
        request,
      });
      return json({ ok: true, status: next.next });
    }

    if (action === "policy") {
      const policy = String(body.policy_action ?? "").trim() as DriverIntegrityPolicyAction;
      const next = applyPolicyAction({
        settings,
        current,
        action: policy,
        adminUserId: session.userId,
      });
      if (next.ok === false) return json({ ok: false, error: next.reason }, 400);
      await supabase.from("driver_integrity_policy_actions").insert({
        incident_id: incidentId,
        action: policy,
        notes: notes || null,
        decided_by: session.userId,
      });
      await supabase
        .from("driver_integrity_incidents")
        .update({
          status: next.next,
          updated_at: new Date().toISOString(),
        })
        .eq("id", incidentId);
      await supabase.from("driver_integrity_events").insert({
        incident_id: incidentId,
        event_type: "DRIVER_INTEGRITY_POLICY_ACTION",
        payload: { admin_user_id: session.userId, policy, notes },
      });
      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "driver_integrity_policy_action",
        targetType: "driver_integrity_incident",
        targetId: incidentId,
        metadata: { policy, notes },
        request,
      });
      return json({ ok: true, status: next.next });
    }

    return json({ ok: false, error: "invalid_action" }, 400);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
