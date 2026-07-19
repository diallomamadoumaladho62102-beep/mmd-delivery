import { NextRequest } from "next/server";
import { getProfileRole, requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { ensureReferralCode, normalizeLoyaltyRole } from "@/lib/loyalty/loyaltyUserApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REFERRAL_BASE_URL = "https://www.mmddelivery.com/r";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const role = normalizeLoyaltyRole(req.nextUrl.searchParams.get("role"));
    const code = await ensureReferralCode(auth.supabaseAdmin, auth.user.id, role);

    const { data: referrals } = await auth.supabaseAdmin
      .from("loyalty_referrals")
      .select("id, referred_user_id, audience, status, rewarded_at, created_at")
      .eq("referrer_user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const list = referrals ?? [];
    const rewarded = list.filter((r) => r.status === "rewarded").length;

    return taxiJson({
      ok: true,
      code,
      link: code ? `${REFERRAL_BASE_URL}/${code}` : null,
      referrals: list,
      counts: { total: list.length, rewarded, pending: list.length - rewarded },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const code = String(body.code ?? "").trim();
    if (!code) return taxiJson({ ok: false, error: "Missing code" }, 400);

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const audience = role === "driver" ? "driver" : "client";

    const { data, error } = await auth.supabaseAdmin.rpc(
      "mmd_loyalty_apply_referral_code",
      {
        p_referred_user_id: auth.user.id,
        p_code: code,
        p_audience: audience,
      }
    );

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return taxiJson({ ok: false, ...result }, 400);
    }
    return taxiJson({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
