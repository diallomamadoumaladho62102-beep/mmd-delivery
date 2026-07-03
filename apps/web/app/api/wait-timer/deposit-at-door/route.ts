import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { authorizeDepositAtDoor } from "@/lib/waitTimerService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data: authData, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !authData.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const entityType = String(body.entity_type ?? "").trim();
  const entityId = String(body.entity_id ?? "").trim();
  const proofPhotoUrl = String(body.proof_photo_url ?? "").trim();

  if (entityType !== "order" && entityType !== "delivery_request") {
    return mmdLocationJson({ ok: false, error: "invalid_entity_type" }, 400);
  }
  if (!entityId || !proofPhotoUrl) {
    return mmdLocationJson({ ok: false, error: "entity_id_and_proof_photo_required" }, 400);
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const result = await authorizeDepositAtDoor(supabaseAdmin, {
      entityType,
      entityId,
      driverUserId: authData.user.id,
      proofPhotoUrl,
    });

    if (result.ok === false) {
      return mmdLocationJson({ ok: false, error: result.error }, 409);
    }

    return mmdLocationJson(result);
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "deposit_at_door_failed" },
      500
    );
  }
}
