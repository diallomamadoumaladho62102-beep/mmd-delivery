import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { getWaitTimerStatus } from "@/lib/waitTimerService";
import { processWaitTimerClientNotifications } from "@/lib/waitTimerNotifications";
import { WAIT_TIMER_ENTITY_TYPES, type WaitTimerEntityType } from "@/lib/waitTimerTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseEntityType(value: unknown): WaitTimerEntityType | null {
  const raw = String(value ?? "").trim();
  return (WAIT_TIMER_ENTITY_TYPES as readonly string[]).includes(raw)
    ? (raw as WaitTimerEntityType)
    : null;
}

export async function GET(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data: authData, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !authData.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const url = new URL(req.url);
  const entityType = parseEntityType(url.searchParams.get("entity_type"));
  const entityId = String(url.searchParams.get("entity_id") ?? "").trim();

  if (!entityType || !entityId) {
    return mmdLocationJson({ ok: false, error: "entity_type_and_entity_id_required" }, 400);
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const result = await getWaitTimerStatus(supabaseAdmin, {
      entityType,
      entityId,
      driverUserId: authData.user.id,
    });

    if (result.ok === false) {
      return mmdLocationJson({ ok: false, error: result.error }, 400);
    }

    await processWaitTimerClientNotifications(supabaseAdmin, {
      entityType,
      entityId,
      clientUserIds: result.client_user_ids,
      entityKind: result.entity_kind,
      timer: result.timer,
      notificationFlags: {
        arrived: result.notification_flags.arrived,
        fee_started: result.notification_flags.fee_started,
        final_warning: result.notification_flags.final_warning,
      },
    });

    return mmdLocationJson(result);
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "wait_timer_status_failed" },
      500
    );
  }
}
