import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.sellers.read", request);
    const supabase = buildSupabaseAdminClient();
    const status = String(new URL(request.url).searchParams.get("status") ?? "").trim();

    let query = supabase
      .from("seller_orders")
      .select(
        "id,seller_id,client_user_id,status,payment_status,currency,subtotal_cents,delivery_fee_cents,service_fee_cents,total_cents,country_code,region_code,notes,checkout_shadow,stripe_checkout_session_id,stripe_payment_intent_id,paid_at,created_at,updated_at,sellers(business_name),seller_order_items(id,product_id,title,price_cents,quantity,currency)"
      )
      .in("status", [
        "draft",
        "pending_checkout",
        "pending_payment",
        "paid",
        "payment_failed",
        "cancelled",
      ])
      .order("created_at", { ascending: false })
      .limit(200);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
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
