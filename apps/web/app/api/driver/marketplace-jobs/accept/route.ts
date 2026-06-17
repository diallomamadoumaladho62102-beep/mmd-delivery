import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import { acceptMarketplaceJobForDriver } from "@/lib/marketplaceDriverJobsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const jobId = String(body.job_id ?? body.jobId ?? "").trim();

  if (!jobId) {
    return mmdLocationJson({ ok: false, error: "job_id_required" }, 400);
  }

  const result = await acceptMarketplaceJobForDriver(auth.supabaseAdmin, {
    driverUserId: auth.user.id,
    jobId,
  });

  if (result.ok === false) {
    const err = result.error;
    const status =
      err === "job_not_available" ? 409 : err === "driver_not_approved" ? 403 : 400;
    return mmdLocationJson({ ok: false, error: err }, status);
  }

  return mmdLocationJson({ ok: true, job: result.job });
}
