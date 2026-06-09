import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_alerts.read", request);
    const supabase = buildSupabaseAdminClient();
    const status = String(request.nextUrl.searchParams.get("status") ?? "open");

    const [dispatch, payment, payout] = await Promise.all([
      supabase
        .from("taxi_dispatch_alerts")
        .select("*")
        .eq("status", status)
        .order("detected_at", { ascending: false })
        .limit(100),
      supabase
        .from("taxi_payment_alerts")
        .select("*")
        .eq("status", status)
        .order("detected_at", { ascending: false })
        .limit(100),
      supabase
        .from("taxi_payout_alerts")
        .select("*")
        .eq("status", status)
        .order("detected_at", { ascending: false })
        .limit(100),
    ]);

    if (dispatch.error || payment.error || payout.error) {
      return json(
        {
          ok: false,
          error:
            dispatch.error?.message ??
            payment.error?.message ??
            payout.error?.message,
        },
        500
      );
    }

    return json({
      ok: true,
      dispatch: dispatch.data ?? [],
      payment: payment.data ?? [],
      payout: payout.data ?? [],
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
