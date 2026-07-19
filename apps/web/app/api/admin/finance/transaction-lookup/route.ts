import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeFinanceAudit } from "@/lib/finance/financeAudit";

export const dynamic = "force-dynamic";

/**
 * Support-safe payment lookup: single entity by id, masked provider refs.
 * Does not expose P&L, ledger, or cross-customer aggregates.
 */
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("finance.transactions.lookup", request).catch(
      async () => {
        await assertStaffPermission("finance.transactions.read", request);
      }
    );

    const entityType = String(
      request.nextUrl.searchParams.get("entity_type") ?? ""
    ).trim();
    const entityId = String(
      request.nextUrl.searchParams.get("entity_id") ?? ""
    ).trim();
    if (!entityType || !entityId) {
      return NextResponse.json(
        { ok: false, error: "entity_type_and_entity_id_required" },
        { status: 400 }
      );
    }

    const allowed = new Set([
      "order",
      "orders",
      "food_order",
      "delivery_request",
      "delivery_requests",
      "taxi_ride",
      "taxi_rides",
      "seller_order",
      "seller_orders",
    ]);
    if (!allowed.has(entityType)) {
      return NextResponse.json(
        { ok: false, error: "unsupported_entity_type" },
        { status: 400 }
      );
    }

    const table =
      entityType === "order" ||
      entityType === "orders" ||
      entityType === "food_order"
        ? "orders"
        : entityType === "delivery_request" ||
            entityType === "delivery_requests"
          ? "delivery_requests"
          : entityType === "taxi_ride" || entityType === "taxi_rides"
            ? "taxi_rides"
            : "seller_orders";

    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from(table)
      .select(
        "id,payment_status,refund_status,total,total_cents,currency,created_at,paid_at,stripe_payment_intent_id,client_user_id"
      )
      .eq("id", entityId)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const row = data as Record<string, unknown>;
    const pi = String(row.stripe_payment_intent_id ?? "");
    const maskedPi =
      pi.length > 10 ? `${pi.slice(0, 6)}…${pi.slice(-4)}` : pi ? "••••" : null;

    const session = await assertStaffPermission(
      "finance.transactions.lookup",
      request
    ).catch(async () =>
      assertStaffPermission("finance.transactions.read", request)
    );

    await writeFinanceAudit({
      supabase,
      adminUserId: session.userId,
      action: "support_transaction_lookup",
      entityType: table,
      entityId,
      request,
      metadata: { masked: true },
    });

    return NextResponse.json({
      ok: true,
      transaction: {
        entity_type: table,
        entity_id: row.id,
        payment_status: row.payment_status ?? null,
        refund_status: row.refund_status ?? null,
        amount_cents:
          Number(row.total_cents ?? 0) ||
          Math.round(Number(row.total ?? 0) * 100),
        currency: row.currency ?? "USD",
        created_at: row.created_at ?? null,
        paid_at: row.paid_at ?? null,
        payment_method_masked: maskedPi,
        client_user_id: row.client_user_id ?? null,
      },
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 }
    );
  }
}
