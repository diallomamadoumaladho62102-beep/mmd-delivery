import { NextRequest, NextResponse } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { adminError, cleanText, json } from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvEscape(value: unknown): string {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const status = cleanText(params.get("status"), 40);
    const exportCsv = params.get("export") === "csv";
    const limit = Math.min(
      500,
      Math.max(1, Number(params.get("limit") ?? 200) || 200),
    );

    let query = supabase
      .from("site_contact_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    if (exportCsv) {
      const header = [
        "id",
        "name",
        "email",
        "phone",
        "subject",
        "message",
        "status",
        "assignee_user_id",
        "internal_notes",
        "created_at",
        "updated_at",
      ];
      const lines = [header.join(",")];
      for (const row of data ?? []) {
        lines.push(
          header.map((k) => csvEscape((row as Record<string, unknown>)[k])).join(","),
        );
      }
      return new NextResponse(lines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="site-contact-submissions.csv"',
        },
      });
    }

    return json({ ok: true, submissions: data ?? [] });
  } catch (e) {
    return adminError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const id = cleanText(body.id, 80);
    if (!id) return json({ ok: false, error: "id required" }, 400);

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.status !== undefined) {
      const status = cleanText(body.status, 40);
      if (status !== "new" && status !== "in_progress" && status !== "done") {
        return json({ ok: false, error: "invalid status" }, 400);
      }
      patch.status = status;
    }
    if (body.internal_notes !== undefined) {
      patch.internal_notes =
        typeof body.internal_notes === "string"
          ? body.internal_notes.slice(0, 10_000)
          : null;
    }
    if (body.assignee_user_id !== undefined) {
      patch.assignee_user_id = cleanText(body.assignee_user_id, 80);
    }

    const { data, error } = await supabase
      .from("site_contact_submissions")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true, submission: data });
  } catch (e) {
    return adminError(e);
  }
}
