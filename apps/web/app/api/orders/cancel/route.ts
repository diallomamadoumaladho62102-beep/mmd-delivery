import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const orderId = String(body.orderId ?? body.order_id ?? "").trim();

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data: order, error: readError } = await supabase
      .from("orders")
      .select("id,status")
      .eq("id", orderId)
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    if (!order) {
      return json({ error: "Order not found" }, 404);
    }

    const status = String(order.status ?? "").toLowerCase();

    if (status === "pending") {
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "canceled",
          cancel_reason: "client_cancelled_before_restaurant_accept",
          cancelled_by: "client",
          cancelled_at: new Date().toISOString(),
          refund_status: "full_refund_required",
        })
        .eq("id", orderId);

      if (updateError) {
        return json({ error: updateError.message }, 500);
      }

      return json({
        ok: true,
        cancelled: true,
        by: "client",
        refund: "FULL",
      });
    }

    if (status === "accepted") {
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "canceled",
          cancel_reason: "client_cancelled_after_restaurant_accept",
          cancelled_by: "client",
          cancelled_at: new Date().toISOString(),
          refund_status: "no_refund",
        })
        .eq("id", orderId);

      if (updateError) {
        return json({ error: updateError.message }, 500);
      }

      return json({
        ok: true,
        cancelled: true,
        by: "client",
        refund: "NONE",
      });
    }

    return json(
      {
        error: "Client cannot cancel this order at this stage",
        status,
      },
      400
    );
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}