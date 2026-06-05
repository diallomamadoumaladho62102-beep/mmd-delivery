import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("driver_offers.read", request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 100), 1), 200);

    const [foodOffers, drOffers] = await Promise.all([
      supabase
        .from("driver_order_offers")
        .select("id, order_id, driver_id, status, wave, expires_at, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("delivery_request_driver_offers")
        .select(
          "id, delivery_request_id, driver_id, status, wave, expires_at, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    if (foodOffers.error) {
      return json({ ok: false, error: foodOffers.error.message }, 500);
    }
    if (drOffers.error) {
      return json({ ok: false, error: drOffers.error.message }, 500);
    }

    return json({
      ok: true,
      food_offers: foodOffers.data ?? [],
      delivery_request_offers: drOffers.data ?? [],
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
