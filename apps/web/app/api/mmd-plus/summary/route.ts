import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import {
  getActiveMmdPlusSubscription,
  listActiveMmdPlusPlans,
  loadMmdPlusPlanFeatures,
} from "@/lib/mmdPlus/mmdPlusEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const supabaseAdmin = auth.supabaseAdmin;
    const [plans, current] = await Promise.all([
      listActiveMmdPlusPlans(supabaseAdmin),
      getActiveMmdPlusSubscription(supabaseAdmin, auth.user.id),
    ]);

    const plansWithFeatures = await Promise.all(
      plans.map(async (plan) => ({
        ...plan,
        features: await loadMmdPlusPlanFeatures(supabaseAdmin, plan.id),
      }))
    );

    let currentEnriched = null;
    if (current) {
      const plan = plans.find((p) => p.id === current.plan_id) ?? null;
      const features = await loadMmdPlusPlanFeatures(supabaseAdmin, current.plan_id);
      currentEnriched = { ...current, plan, features };
    }

    const { data: invoices } = await supabaseAdmin
      .from("mmd_plus_invoices")
      .select(
        "id, kind, status, amount_cents, currency, description, created_at, paid_at, stripe_invoice_id"
      )
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    return taxiJson({
      ok: true,
      current: currentEnriched,
      plans: plansWithFeatures,
      invoices: invoices ?? [],
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}
