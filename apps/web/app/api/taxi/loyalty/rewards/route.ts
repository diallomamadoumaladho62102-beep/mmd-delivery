import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_loyalty_rewards")
      .select(
        "id, title, description, points_cost, discount_cents, tier_required, active"
      )
      .eq("active", true)
      .order("points_cost", { ascending: true });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({ ok: true, rewards: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
