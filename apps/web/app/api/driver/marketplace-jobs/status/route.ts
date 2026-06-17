import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import { updateMarketplaceJobStatusForDriver } from "@/lib/marketplaceDriverJobsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const jobId = String(body.job_id ?? body.jobId ?? "").trim();
  const nextStatusRaw = String(body.status ?? "").trim().toLowerCase();

  if (!jobId) {
    return mmdLocationJson({ ok: false, error: "job_id_required" }, 400);
  }

  if (nextStatusRaw !== "picked_up" && nextStatusRaw !== "delivered") {
    return mmdLocationJson({ ok: false, error: "invalid_status" }, 400);
  }

  const result = await updateMarketplaceJobStatusForDriver(auth.supabaseAdmin, {
    driverUserId: auth.user.id,
    jobId,
    nextStatus: nextStatusRaw,
  });

  if (result.ok === false) {
    const err = result.error;
    const status = err === "invalid_status_transition" ? 409 : 400;
    return mmdLocationJson({ ok: false, error: err }, status);
  }

  return mmdLocationJson({ ok: true, job: result.job });
}
