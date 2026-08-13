import { NextRequest } from "next/server";
import { requireDriver } from "@/lib/driverServicePreferencesAuth";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireDriver(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const opportunityId = String(body.opportunity_id ?? "").trim();
  const saved = Boolean(body.saved);

  if (!opportunityId) {
    return json({ ok: false, error: "opportunity_id_required" }, 400);
  }

  try {
    const { data: opportunity, error: oppError } = await auth.supabaseAdmin
      .from("driver_opportunities")
      .select("id, status")
      .eq("id", opportunityId)
      .maybeSingle();

    if (oppError) throw oppError;
    if (!opportunity || opportunity.status !== "published") {
      return json(
        { ok: false, error: "opportunity_not_found", message: "Opportunity is not available." },
        404,
      );
    }

    if (saved) {
      const { error } = await auth.supabaseAdmin.from("driver_saved_opportunities").upsert(
        {
          driver_id: auth.userId,
          opportunity_id: opportunityId,
        },
        { onConflict: "driver_id,opportunity_id" },
      );
      if (error) throw error;
    } else {
      const { error } = await auth.supabaseAdmin
        .from("driver_saved_opportunities")
        .delete()
        .eq("driver_id", auth.userId)
        .eq("opportunity_id", opportunityId);
      if (error) throw error;
    }

    return json({ ok: true, opportunity_id: opportunityId, saved });
  } catch (e) {
    logTechnicalError("driver.opportunities.save", e, {
      userId: auth.userId,
      opportunityId,
      saved,
    });
    return json(
      {
        ok: false,
        error: "save_failed",
        message: toUserFacingError(e, "Unable to update saved opportunity."),
      },
      500,
    );
  }
}
