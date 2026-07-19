import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { buildLoyaltySummary, normalizeLoyaltyRole } from "@/lib/loyalty/loyaltyUserApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const role = normalizeLoyaltyRole(req.nextUrl.searchParams.get("role"));
    const summary = await buildLoyaltySummary(auth.supabaseAdmin, auth.user.id, role);
    return taxiJson({ ok: true, summary });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
