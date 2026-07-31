import { NextRequest } from "next/server";
import {
  mmdLocationJson,
  requireMmdLocationApiUser,
} from "@/lib/mmdLocationCore";
import { getProfileRole, isStaffRole } from "@/lib/taxiApi";
import { buildFoodOrderReceiptPayload } from "@/lib/finance/buildFoodOrderReceipt";
import type { FinancialActorRole } from "@/lib/finance/financialTimelineTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Food order customer receipt.
 * Auth: any signed-in user (same base as food APIs); ownership / driver / staff
 * enforced inside the builder. Avoids checkout-scope gates so staff/drivers can view.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireMmdLocationApiUser(req);
    if (auth.ok === false) return auth.response;

    const { id } = await context.params;
    const profileRole = await getProfileRole(auth.supabaseAdmin, auth.user.id);

    let role: FinancialActorRole = "client";
    if (isStaffRole(profileRole)) role = "admin";
    else if (profileRole === "driver") role = "driver";

    const result = await buildFoodOrderReceiptPayload(auth.supabaseAdmin, {
      orderId: id,
      role,
      viewerUserId: auth.user.id,
    });

    if ("error" in result) {
      return mmdLocationJson({ ok: false, error: result.error }, result.status);
    }

    return mmdLocationJson({ ok: true, receipt: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return mmdLocationJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return mmdLocationJson({ error: "Method not allowed" }, 405);
}
