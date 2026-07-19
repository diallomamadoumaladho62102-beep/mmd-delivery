import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAnalyticsAudit } from "@/lib/analytics/analyticsAudit";
import {
  exportContentType,
  exportFilename,
  rowsToCsv,
  rowsToExcelCsv,
  rowsToSimplePdf,
  type ExportFormat,
} from "@/lib/analytics/analyticsExport";
import { listAnalyticsExportRows } from "@/lib/analytics/analyticsQuery";
import {
  isAnalyticsModule,
  parseAnalyticsFilters,
  type AnalyticsModule,
} from "@/lib/analytics/analyticsTypes";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("analytics.export", request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const moduleParam = String(body.module ?? "global");
    const format = String(body.format ?? "csv").toLowerCase() as ExportFormat;

    if (!isAnalyticsModule(moduleParam)) {
      return json({ ok: false, error: "invalid_module" }, 400);
    }
    if (!["csv", "excel", "pdf"].includes(format)) {
      return json({ ok: false, error: "invalid_format" }, 400);
    }
    if (moduleParam === "finance") {
      await assertStaffPermission("analytics.finance", request);
    }

    const filters = parseAnalyticsFilters({
      from: body.from ? String(body.from) : undefined,
      to: body.to ? String(body.to) : undefined,
      country: body.country_code ? String(body.country_code) : undefined,
      city: body.city ? String(body.city) : undefined,
      service: body.service ? String(body.service) : undefined,
      user_id: body.user_id ? String(body.user_id) : undefined,
      partner_user_id: body.partner_user_id ? String(body.partner_user_id) : undefined,
      campaign_id: body.campaign_id ? String(body.campaign_id) : undefined,
    });

    const supabase = buildSupabaseAdminClient();
    const rows = await listAnalyticsExportRows(
      supabase,
      moduleParam as AnalyticsModule,
      filters
    );

    const correlationId = crypto.randomUUID();
    await writeAnalyticsAudit({
      supabase,
      adminUserId: session.userId,
      action: "export",
      module: moduleParam,
      format,
      filters: filters as Record<string, unknown>,
      rowCount: rows.length,
      correlationId,
      request,
    });

    let bodyOut: string | Uint8Array;
    if (format === "pdf") {
      bodyOut = rowsToSimplePdf(`MMD Analytics — ${moduleParam}`, rows);
    } else if (format === "excel") {
      bodyOut = rowsToExcelCsv(rows);
    } else {
      bodyOut = rowsToCsv(rows);
    }

    const filename = exportFilename(moduleParam, format);
    return new NextResponse(bodyOut, {
      status: 200,
      headers: {
        "Content-Type": exportContentType(format),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Correlation-Id": correlationId,
      },
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
}
