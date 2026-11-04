import { NextRequest } from "next/server";
import { mmdLocationJson, requireMmdLocationApiUser } from "@/lib/mmdLocationCore";
import { collectFoodOrderCash } from "@/lib/markets/guineaLocalCashCollect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireMmdLocationApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const orderId = String(body.order_id ?? body.orderId ?? "").trim();
    if (!orderId) {
      return mmdLocationJson({ ok: false, error: "missing_order_id" }, 400);
    }

    const result = await collectFoodOrderCash(auth.supabaseAdmin, {
      actorUserId: auth.user.id,
      orderId,
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
