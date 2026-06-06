import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanModifyPricing,
  assertCanReadPricing,
} from "@/lib/adminServer";
import {
  PRICING_CONFIG_SELECT,
  savePricingConfig,
} from "@/lib/adminPricingSave";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertCanReadPricing(request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("pricing_config")
      .select(PRICING_CONFIG_SELECT)
      .order("config_key", { ascending: true });

    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanModifyPricing(request);
    const supabase = buildSupabaseAdminClient();
    const formData = await request.formData();

    await savePricingConfig(supabase, session.userId, formData);

    return json({ ok: true });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 400;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
