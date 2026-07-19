import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { resolveCommission } from "@/lib/commission/commissionEngine";
import { PARTNER_TYPES, SERVICES } from "@/lib/commission/commissionAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

/**
 * GET ?partnerType=&partnerUserId=&service=
 * Returns the currently resolved commission for a partner (preview, no snapshot).
 * Also returns active loyalty benefit flags and any personalized override.
 */
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("commissions.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;

    const partnerType = String(params.get("partnerType") ?? "").trim();
    const partnerUserId = String(params.get("partnerUserId") ?? "").trim();
    const service = String(params.get("service") ?? "").trim();
    const countryCode = params.get("countryCode");
    const city = params.get("city");
    const category = params.get("category");

    if (!PARTNER_TYPES.has(partnerType)) {
      return json({ ok: false, error: "Invalid partnerType" }, 400);
    }
    if (!UUID_RE.test(partnerUserId)) {
      return json({ ok: false, error: "Invalid partnerUserId" }, 400);
    }
    if (!SERVICES.has(service)) {
      return json({ ok: false, error: "Invalid service" }, 400);
    }

    const resolved = await resolveCommission(supabase, {
      partnerType: partnerType as "restaurant" | "seller",
      partnerUserId,
      service: service as "food" | "marketplace",
      countryCode,
      city,
      category,
    });

    const [{ data: override }, { data: contracts }, loyaltyBenefits] = await Promise.all([
      supabase
        .from("partner_commission_overrides")
        .select("*")
        .eq("partner_type", partnerType)
        .eq("partner_user_id", partnerUserId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(5),
      supabase
        .from("commercial_contracts")
        .select("id, name, rate_pct, fixed_fee_cents, status, starts_at, ends_at")
        .eq("partner_type", partnerType)
        .eq("partner_user_id", partnerUserId)
        .in("status", ["active", "draft", "suspended"])
        .order("updated_at", { ascending: false })
        .limit(10),
      partnerType === "restaurant"
        ? supabase
            .from("restaurant_active_benefits")
            .select("id, benefit_type, benefit_value, status, starts_at, expires_at")
            .eq("restaurant_user_id", partnerUserId)
            .in("benefit_type", ["commission_discount", "service_fee_credit"])
            .in("status", ["active", "scheduled"])
        : supabase
            .from("marketplace_active_benefits")
            .select("id, benefit_type, benefit_value, status, starts_at, expires_at")
            .eq("seller_user_id", partnerUserId)
            .in("benefit_type", ["commission_discount", "marketplace_fee_credit"])
            .in("status", ["active", "scheduled"]),
    ]);

    let partnerLabel: string | null = null;
    if (partnerType === "restaurant") {
      const { data } = await supabase
        .from("restaurant_profiles")
        .select("restaurant_name, city")
        .eq("user_id", partnerUserId)
        .maybeSingle();
      partnerLabel = (data?.restaurant_name as string) ?? null;
    } else {
      const { data } = await supabase
        .from("sellers")
        .select("business_name, city")
        .eq("user_id", partnerUserId)
        .maybeSingle();
      partnerLabel = (data?.business_name as string) ?? null;
    }

    return json({
      ok: true,
      partner: { partner_type: partnerType, partner_user_id: partnerUserId, label: partnerLabel },
      resolved,
      overrides: override ?? [],
      contracts: contracts ?? [],
      loyalty_benefits: loyaltyBenefits.data ?? [],
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
