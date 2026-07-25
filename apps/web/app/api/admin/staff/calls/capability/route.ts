import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertStaffPermission,
} from "@/lib/adminServer";
import { getStaffCallProviderPlan } from "@/lib/staffCallsProvider";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("hub.access", request);
    const plan = getStaffCallProviderPlan();
    return NextResponse.json({
      ok: true,
      ...plan,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status }
    );
  }
}
