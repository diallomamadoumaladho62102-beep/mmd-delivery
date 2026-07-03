import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanReadPricing,
} from "@/lib/adminServer";
import {
  PAYOUT_METHOD_SELECT,
  adminPayoutMethodsPublicInfo,
  buildAdminPayoutMethodView,
} from "@/lib/adminPayoutMethods";
import { normalizeCountryCode } from "@/lib/paymentProviderRouting";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { PayoutMethodRow, PayoutRecipientType } from "@/lib/payoutTypes";

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
    const recipientFilter = String(
      request.nextUrl.searchParams.get("recipient_type") ?? ""
    ).trim() as PayoutRecipientType;

    let query = supabase
      .from("payout_methods")
      .select(PAYOUT_METHOD_SELECT)
      .order("country_code", { ascending: true })
      .order("recipient_type", { ascending: true })
      .order("sort_order", { ascending: true });

    if (countryFilter.length === 2) {
      query = query.eq("country_code", countryFilter);
    }
    if (recipientFilter) {
      query = query.eq("recipient_type", recipientFilter);
    }

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const items = (data ?? []).map((row) =>
      buildAdminPayoutMethodView(row as PayoutMethodRow)
    );

    return json({
      ok: true,
      items,
      meta: adminPayoutMethodsPublicInfo(),
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
