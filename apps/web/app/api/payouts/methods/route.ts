import { NextRequest } from "next/server";
import { getBearerToken, getSupabaseAdminClient, getSupabaseUserClient, mmdLocationJson } from "@/lib/mmdLocationCore";
import { loadPayoutMethodsForRecipient } from "@/lib/payoutMethodRouting";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";
import { PAYOUT_RECIPIENT_TYPES, type PayoutRecipientType } from "@/lib/payoutTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data, error } = await supabaseUser.auth.getUser();
  if (error || !data.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const url = new URL(req.url);
  const countryCode = normalizeCountryCode(url.searchParams.get("country_code"));
  if (!countryCode) {
    return mmdLocationJson({ ok: false, error: "country_code_required" }, 400);
  }

  const recipientType = String(url.searchParams.get("recipient_type") ?? "driver").trim() as PayoutRecipientType;
  if (!(PAYOUT_RECIPIENT_TYPES as readonly string[]).includes(recipientType)) {
    return mmdLocationJson({ ok: false, error: "invalid_recipient_type" }, 400);
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const methods = await loadPayoutMethodsForRecipient(
      supabaseAdmin,
      countryCode,
      recipientType
    );

    return mmdLocationJson({
      ok: true,
      country_code: countryCode,
      recipient_type: recipientType,
      methods,
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "payout_methods_load_failed" },
      500
    );
  }
}
