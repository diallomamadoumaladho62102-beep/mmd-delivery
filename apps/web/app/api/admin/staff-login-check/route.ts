import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  resolveAdminSession,
} from "@/lib/adminServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await resolveAdminSession(request);
    return json({
      ok: true,
      userId: session.userId,
      role: session.role,
      accountStatus: session.accountStatus,
      isFounder: session.isFounder,
    });
  } catch (error) {
    const status = error instanceof AdminAccessError ? error.status : 500;
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unauthorized",
      },
      status,
    );
  }
}
