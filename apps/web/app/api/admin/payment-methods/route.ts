import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanModifyPricing,
  assertCanReadPricing,
} from "@/lib/adminServer";
import {
  PAYMENT_METHOD_SELECT,
  adminPaymentMethodsPublicInfo,
  buildAdminPaymentMethodView,
} from "@/lib/adminPaymentMethods";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { PaymentMethodRow } from "@/lib/paymentTypes";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertCanReadPricing(request);
    const supabase = buildSupabaseAdminClient();
    const countryFilter = normalizeCountryCode(
      request.nextUrl.searchParams.get("country_code") ?? ""
    );

    let query = supabase
      .from("payment_methods")
      .select(PAYMENT_METHOD_SELECT)
      .order("country_code", { ascending: true })
      .order("sort_order", { ascending: true });

    if (countryFilter.length === 2) {
      query = query.eq("country_code", countryFilter);
    }

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const items = (data ?? []).map((row) =>
      buildAdminPaymentMethodView(row as PaymentMethodRow)
    );

    return json({
      ok: true,
      items,
      meta: adminPaymentMethodsPublicInfo(),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST() {
  return json({ ok: false, error: "Method not allowed" }, 405);
}
