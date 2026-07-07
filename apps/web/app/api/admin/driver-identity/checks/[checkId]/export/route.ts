import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  loadFullInvestigationExport,
  logIdentityViewAudit,
} from "@/lib/driverIdentityInvestigation";
import { buildDriverIdentityInvestigationPdf } from "@/lib/driverIdentityInvestigationPdf";
import { isAdmin } from "@/lib/roles";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ checkId: string }> };

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

  const format = String(req.nextUrl.searchParams.get("format") ?? "json")
    .trim()
    .toLowerCase();

  if (format !== "json" && format !== "pdf") {
    return adminJson({ ok: false, error: "invalid_format" }, 400);
  }

  const { checkId } = await context.params;
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
    const exportPayload = await loadFullInvestigationExport(
      admin,
      check.driver_id,
      checkId,
      check,
    );

    const auditAction = format === "pdf" ? "export_pdf" : "export_json";

    await logIdentityViewAudit(admin, {
      checkId,
      driverId: check.driver_id,
      staffUserId: staff.userId,
      action: auditAction,
      section: "full_export",
      request: req,
      metadata: { duration_ms: Date.now() - startedAt, format },
    });

    const enriched = {
      ...exportPayload,
      export_audit: {
        exported_by: staff.userId,
        exported_at: new Date().toISOString(),
        format,
        duration_ms: Date.now() - startedAt,
      },
    };

    if (format === "json") {
      return adminJson({ ok: true, export: enriched });
    }

    const pdfBytes = await buildDriverIdentityInvestigationPdf(enriched);
    const filename = `driver-identity-${checkId.slice(0, 8)}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "export_failed";
    return adminJson({ ok: false, error: message }, 500);
  }
}
