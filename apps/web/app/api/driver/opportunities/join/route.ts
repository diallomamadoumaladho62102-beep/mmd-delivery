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
  if (!opportunityId) {
    return json({ ok: false, error: "opportunity_id_required" }, 400);
  }

  try {
    const { data: opportunity, error: oppError } = await auth.supabaseAdmin
      .from("driver_opportunities")
      .select("id, status, capacity, title")
      .eq("id", opportunityId)
      .maybeSingle();

    if (oppError) throw oppError;
    if (!opportunity || opportunity.status !== "published") {
      return json(
        { ok: false, error: "opportunity_not_found", message: "Opportunity is not available." },
        404,
      );
    }

    const { data: existingSignup, error: existingError } = await auth.supabaseAdmin
      .from("driver_opportunity_signups")
      .select("id")
      .eq("driver_id", auth.userId)
      .eq("opportunity_id", opportunityId)
      .maybeSingle();

    if (existingError) throw existingError;
    if (existingSignup) {
      return json({ ok: true, opportunity_id: opportunityId, joined: true, already_joined: true });
    }

    const capacity = opportunity.capacity == null ? null : Number(opportunity.capacity);
    if (capacity != null && Number.isFinite(capacity) && capacity > 0) {
      const { count, error: countError } = await auth.supabaseAdmin
        .from("driver_opportunity_signups")
        .select("id", { count: "exact", head: true })
        .eq("opportunity_id", opportunityId);

      if (countError) throw countError;
      if ((count ?? 0) >= capacity) {
        return json(
          {
            ok: false,
            error: "capacity_full",
            message: "This opportunity is full.",
          },
          409,
        );
      }
    }

    const { error: insertError } = await auth.supabaseAdmin.from("driver_opportunity_signups").insert({
      driver_id: auth.userId,
      opportunity_id: opportunityId,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return json({ ok: true, opportunity_id: opportunityId, joined: true, already_joined: true });
      }
      throw insertError;
    }

    return json({ ok: true, opportunity_id: opportunityId, joined: true });
  } catch (e) {
    logTechnicalError("driver.opportunities.join", e, {
      userId: auth.userId,
      opportunityId,
    });
    return json(
      {
        ok: false,
        error: "join_failed",
        message: toUserFacingError(e, "Unable to join this opportunity."),
      },
      500,
    );
  }
}
