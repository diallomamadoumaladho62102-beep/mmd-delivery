import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Driver bonus / objectives portal API */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { data: objectives } = await auth.supabaseAdmin
      .from("marketing_driver_objectives")
      .select("*")
      .eq("status", "active")
      .order("ends_at", { ascending: true })
      .limit(40);

    const { data: progress } = await auth.supabaseAdmin
      .from("marketing_driver_progress")
      .select("*, marketing_driver_objectives(title, target_count, reward_cents, reward_points, ends_at)")
      .eq("driver_user_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(40);

    return taxiJson({
      ok: true,
      objectives: objectives ?? [],
      progress: progress ?? [],
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}
