import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { normalizeLoyaltyRole } from "@/lib/loyalty/loyaltyUserApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const role = normalizeLoyaltyRole(req.nextUrl.searchParams.get("role"));
    const limit = Math.min(
      100,
      Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50)
    );

    const [points, credit] = await Promise.all([
      auth.supabaseAdmin
        .from("loyalty_ledger")
        .select(
          "id, delta_points, balance_after, entry_type, reference_type, reference_id, description, created_at"
        )
        .eq("user_id", auth.user.id)
        .eq("role", role)
        .order("created_at", { ascending: false })
        .limit(limit),
      auth.supabaseAdmin
        .from("mmd_credit_ledger")
        .select(
          "id, delta_cents, balance_after_cents, entry_type, reference_type, reference_id, description, currency, created_at"
        )
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (points.error) return taxiJson({ ok: false, error: points.error.message }, 500);
    if (credit.error) return taxiJson({ ok: false, error: credit.error.message }, 500);

    return taxiJson({
      ok: true,
      points: points.data ?? [],
      credit: credit.data ?? [],
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
