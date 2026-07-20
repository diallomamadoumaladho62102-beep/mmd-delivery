import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertAdminAccess,
} from "@/lib/adminServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertAdminAccess(request);

    return json({
      ok: true,
      userId: session.userId,
      role: session.role,
      accountStatus: session.accountStatus,
      isFounder: session.isFounder,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Unauthorized" },
      status
    );
  }
}
