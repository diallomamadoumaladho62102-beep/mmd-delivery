import { NextRequest } from "next/server";
import { driverAcceptJson, requireDriverAcceptUser } from "@/lib/driverAcceptApi";
import { evaluateDriverIdentity, recordDriverOnlineAttempt } from "@/lib/driverIdentityService";
import { hashIp } from "@/lib/driverIdentityRiskEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return req.headers.get("x-real-ip");
}

export async function GET(req: NextRequest) {
  const auth = await requireDriverAcceptUser(req);
  if (auth.ok === false) return auth.response;

  const url = new URL(req.url);
  const intentRaw = String(url.searchParams.get("intent") ?? "refresh").trim().toLowerCase();
  const intent = intentRaw === "go_online" ? "go_online" : "refresh";

  const deviceId = url.searchParams.get("device_id") ?? url.searchParams.get("deviceId");
  const city = url.searchParams.get("city");
  const country = url.searchParams.get("country");

  try {
    const status = await evaluateDriverIdentity(auth.supabaseAdmin, {
      driverId: auth.user.id,
      deviceIdHash: deviceId,
      city,
      country,
      ipHash: hashIp(clientIp(req)),
      intent,
    });

    if (intent === "go_online" && status.canGoOnline) {
      await recordDriverOnlineAttempt(auth.supabaseAdmin, auth.user.id);
    }

    return driverAcceptJson({
      ok: true,
      gate_status: status.gateStatus,
      can_go_online: status.canGoOnline,
      message: status.message,
      reason: status.reason,
      active_check: status.activeCheck
        ? {
            id: status.activeCheck.id,
            status: status.activeCheck.status,
            trigger_type: status.activeCheck.trigger_type,
            reason: status.activeCheck.reason,
            requires_manual_review: status.activeCheck.requires_manual_review,
            expires_at: status.activeCheck.expires_at,
            created_at: status.activeCheck.created_at,
            submitted_at: status.activeCheck.submitted_at,
          }
        : null,
    });
  } catch (error) {
    console.error("driver identity status error:", error);
    return driverAcceptJson({ ok: false, error: "identity_status_failed" }, 500);
  }
}
