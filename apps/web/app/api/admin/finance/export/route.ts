import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeFinanceAudit } from "@/lib/finance/financeAudit";
import { listJournalEntries } from "@/lib/finance/financeDashboard";
import {
  exportContentType,
  exportFilename,
  rowsToCsv,
  rowsToExcelCsv,
  rowsToSimplePdf,
  type ExportFormat,
} from "@/lib/analytics/analyticsExport";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("finance.export", request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const format = String(body.format ?? "csv").toLowerCase() as ExportFormat;
    if (!["csv", "excel", "pdf", "json"].includes(format)) {
      return json({ ok: false, error: "invalid_format" }, 400);
    }

    const supabase = buildSupabaseAdminClient();
    const entries = await listJournalEntries(supabase, {
      limit: Number(body.limit ?? 500),
      from: body.from ? String(body.from) : undefined,
      to: body.to ? String(body.to) : undefined,
      status: body.status ? String(body.status) : "posted",
    });

    const rows = entries.map((e) => ({
      id: e.id,
      accounting_date: e.accounting_date,
      event_type: e.event_type,
      vertical: e.vertical,
      currency: e.currency,
      status: e.status,
      source_type: e.source_type,
      source_id: e.source_id,
      description: e.description,
    }));

    const correlationId = crypto.randomUUID();
    await writeFinanceAudit({
      supabase,
      adminUserId: session.userId,
      action: "export",
      entityType: "finance_journal_entries",
      correlationId,
      request,
      metadata: { format, row_count: rows.length },
    });

    await supabase.from("finance_report_exports").insert({
      report_type: "journal",
      format: format === "excel" ? "excel" : format,
      filters: body,
      status: "ready",
      row_count: rows.length,
      requested_by: session.userId,
      completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    });

    if (format === "json") {
      return json({ ok: true, rows, correlation_id: correlationId });
    }

    let out: string | Uint8Array;
    if (format === "pdf") out = rowsToSimplePdf("MMD Finance Journal", rows);
    else if (format === "excel") out = rowsToExcelCsv(rows);
    else out = rowsToCsv(rows);

    return new NextResponse(out, {
      status: 200,
      headers: {
        "Content-Type": exportContentType(format),
        "Content-Disposition": `attachment; filename="${exportFilename("finance-journal", format)}"`,
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
