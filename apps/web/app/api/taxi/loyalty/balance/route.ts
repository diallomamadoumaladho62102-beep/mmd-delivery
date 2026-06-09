import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_loyalty_accounts")
      .select("user_id, points_balance, lifetime_points, tier, updated_at")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({
      ok: true,
      account: data ?? {
        user_id: auth.user.id,
        points_balance: 0,
        lifetime_points: 0,
        tier: "bronze",
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
