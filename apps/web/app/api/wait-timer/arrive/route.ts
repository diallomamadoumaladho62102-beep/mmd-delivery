import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { recordDriverArrival } from "@/lib/waitTimerService";
import { processWaitTimerClientNotifications } from "@/lib/waitTimerNotifications";
import { WAIT_TIMER_ENTITY_TYPES, type WaitTimerEntityType } from "@/lib/waitTimerTypes";
import { computeWaitTimerState } from "@/lib/waitFeeCalculator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseEntityType(value: unknown): WaitTimerEntityType | null {
  const raw = String(value ?? "").trim();
  return (WAIT_TIMER_ENTITY_TYPES as readonly string[]).includes(raw)
    ? (raw as WaitTimerEntityType)
    : null;
}

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
  const entityType = parseEntityType(body.entity_type);
  const entityId = String(body.entity_id ?? "").trim();
  const driverLat = Number(body.driver_lat);
  const driverLng = Number(body.driver_lng);
  const forceManual = Boolean(body.force_manual);

  if (!entityType || !entityId) {
    return mmdLocationJson({ ok: false, error: "entity_type_and_entity_id_required" }, 400);
  }
  if (!Number.isFinite(driverLat) || !Number.isFinite(driverLng)) {
    return mmdLocationJson({ ok: false, error: "driver_coordinates_required" }, 400);
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const result = await recordDriverArrival(supabaseAdmin, {
      entityType,
      entityId,
      driverUserId: authData.user.id,
      driverLat,
      driverLng,
      forceManual,
    });

    if (result.ok === false) {
      const status =
        result.error === "too_far_from_target" ||
        result.error === "manual_arrival_required"
          ? 409
          : 400;
      return mmdLocationJson({ ok: false, error: result.error }, status);
    }

    const timer = computeWaitTimerState({
      waitTimerStartedAt: result.wait_timer_started_at,
      entityKind: result.entity_kind,
    });

    await processWaitTimerClientNotifications(supabaseAdmin, {
      entityType,
      entityId,
      clientUserIds: result.client_user_ids,
      entityKind: result.entity_kind,
      timer,
      notificationFlags: { arrived: null, fee_started: null, final_warning: null },
      justArrived: true,
    });

    return mmdLocationJson({ ok: true, ...result, timer });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "wait_timer_arrive_failed" },
      500
    );
  }
}
