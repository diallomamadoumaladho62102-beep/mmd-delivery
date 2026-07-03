import { NextRequest } from "next/server";
import { getBearerToken, getSupabaseAdminClient, getSupabaseUserClient, mmdLocationJson } from "@/lib/mmdLocationCore";
import { loadPaymentMethodsForCountry, normalizeCountryCode } from "@/lib/paymentProviderRouting";
import type { PaymentEntityType } from "@/lib/paymentTypes";

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

  const entityType = String(url.searchParams.get("entity_type") ?? "").trim() as PaymentEntityType;

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const methods = await loadPaymentMethodsForCountry(supabaseAdmin, countryCode);
    const localMethods = methods.filter((method) => method.provider !== "stripe");
    const stripeMethods = methods.filter((method) => method.provider === "stripe");

    return mmdLocationJson({
      ok: true,
      country_code: countryCode,
      entity_type: entityType || null,
      methods,
      local_methods: localMethods,
      stripe_methods: stripeMethods,
      prefer_local_mobile_money: ["GN", "SN", "CI"].includes(countryCode),
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "payment_methods_load_failed" },
      500
    );
  }
}
