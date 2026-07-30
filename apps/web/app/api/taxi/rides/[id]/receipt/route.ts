import { NextRequest } from "next/server";
import {
  getProfileRole,
  isStaffRole,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import { buildTaxiReceiptPayload } from "@/lib/finance/buildTaxiReceipt";
import type { FinancialActorRole } from "@/lib/finance/financialTimelineTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { id } = await context.params;
    const profileRole = await getProfileRole(auth.supabaseAdmin, auth.user.id);

    let role: FinancialActorRole = "client";
    if (isStaffRole(profileRole)) role = "admin";
    else if (profileRole === "driver") role = "driver";

    const result = await buildTaxiReceiptPayload(auth.supabaseAdmin, {
      rideId: id,
      role,
      viewerUserId: auth.user.id,
    });

    if ("error" in result) {
      return taxiJson({ ok: false, error: result.error }, result.status);
    }

    return taxiJson({ ok: true, receipt: result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
