import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import {
  getMarketplaceJobForDriver,
  listMarketplaceJobsForDriver,
} from "@/lib/marketplaceDriverJobsService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;

  const jobId = new URL(req.url).searchParams.get("job_id")?.trim() || "";

  if (jobId) {
    const result = await getMarketplaceJobForDriver(auth.supabaseAdmin, {
      driverUserId: auth.user.id,
      jobId,
    });

    if (result.ok === false) {
      const err = result.error;
      const status = err === "job_not_found" || err === "job_not_accessible" ? 404 : 403;
      return mmdLocationJson({ ok: false, error: err }, status);
    }

    return mmdLocationJson({ ok: true, job: result.job });
  }

  const result = await listMarketplaceJobsForDriver(auth.supabaseAdmin, auth.user.id);
  if (result.ok === false) {
    const err = result.error;
    return mmdLocationJson({ ok: false, error: err }, 403);
  }

  return mmdLocationJson({
    ok: true,
    available: result.available,
    mine: result.mine,
  });
}
