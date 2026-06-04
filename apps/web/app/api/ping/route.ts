import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
}

function isAuthorized(req: NextRequest): boolean {
  if (!isProduction()) return true;

  const cronSecret = (process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return false;

  const headerSecret = (req.headers.get("x-cron-secret") || "").trim();
  if (headerSecret && headerSecret === cronSecret) return true;

  const authHeader = req.headers.get("authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() ?? "";
  return bearer.length > 0 && bearer === cronSecret;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    method: "GET",
    time: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    method: "POST",
    time: new Date().toISOString(),
  });
}
