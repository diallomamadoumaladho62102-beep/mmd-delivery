import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import { collectDeliveryRequestCash } from "@/lib/markets/guineaLocalCashCollect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireMmdLocationApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestId = String(body.request_id ?? body.requestId ?? "").trim();
    if (!requestId) {
      return mmdLocationJson({ ok: false, error: "missing_request_id" }, 400);
    }

    const result = await collectDeliveryRequestCash(auth.supabaseAdmin, {
      actorUserId: auth.user.id,
      requestId,
    });
    return mmdLocationJson(result.body, result.status);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    return mmdLocationJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return mmdLocationJson({ error: "Method not allowed" }, 405);
}
