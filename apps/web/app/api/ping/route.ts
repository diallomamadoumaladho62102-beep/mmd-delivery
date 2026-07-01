import { isInternalHealthAuthorized } from "@/lib/internalHealthAuth";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isInternalHealthAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    method: "GET",
    time: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  if (!isInternalHealthAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    method: "POST",
    time: new Date().toISOString(),
  });
}
