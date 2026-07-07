import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  loadInvestigationSection,
  logIdentityViewAudit,
  type InvestigationSection,
} from "@/lib/driverIdentityInvestigation";
import { isAdmin } from "@/lib/roles";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ checkId: string }> };

const VALID_SECTIONS = new Set<InvestigationSection>([
  "driver-history",
  "security-history",
  "geography",
  "trust-score",
  "ai-insight",
  "view-audit",
]);

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest, context: RouteContext) {
  let staff;
  try {
    staff = await assertStaffPermission("drivers.identity.read", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  if (!isAdmin(staff.role)) {
    return adminJson({ ok: false, error: "Super Admin required" }, 403);
  }

  const { checkId } = await context.params;
  const section = String(req.nextUrl.searchParams.get("section") ?? "").trim() as InvestigationSection;

  if (!VALID_SECTIONS.has(section)) {
    return adminJson({ ok: false, error: "invalid_section" }, 400);
  }

  const admin = buildSupabaseAdminClient();
  const startedAt = Date.now();

  const { data: check, error } = await admin
    .from("driver_identity_checks")
    .select("*")
    .eq("id", checkId)
    .maybeSingle();

  if (error) return adminJson({ ok: false, error: error.message }, 500);
  if (!check) return adminJson({ ok: false, error: "not_found" }, 404);

  try {
    const data = await loadInvestigationSection(
      admin,
      check.driver_id,
      checkId,
      section,
      check,
    );

    await logIdentityViewAudit(admin, {
      checkId,
      driverId: check.driver_id,
      staffUserId: staff.userId,
      action: "view_section",
      section,
      request: req,
      metadata: { duration_ms: Date.now() - startedAt },
    });

    return adminJson({
      ok: true,
      section,
      data,
      duration_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "investigation_failed";
    return adminJson({ ok: false, error: message }, 500);
  }
}
