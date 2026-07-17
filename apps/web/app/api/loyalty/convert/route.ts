import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { buildLoyaltySummary } from "@/lib/loyalty/loyaltyUserApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const blocks = Math.max(1, Math.round(Number(body.blocks ?? 1)) || 1);
    const idempotencyKey =
      typeof body.idempotency_key === "string" && body.idempotency_key.trim()
        ? body.idempotency_key.trim().slice(0, 120)
        : null;

    const { data, error } = await auth.supabaseAdmin.rpc("mmd_convert_points", {
      p_user_id: auth.user.id,
      p_blocks: blocks,
      p_idempotency_key: idempotencyKey,
    });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return taxiJson({ ok: false, ...result }, 400);
    }

    const summary = await buildLoyaltySummary(auth.supabaseAdmin, auth.user.id);
    return taxiJson({ ok: true, result, summary });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
