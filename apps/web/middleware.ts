import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  checkRateLimit,
  classifyApiPath,
  getRequestClientIp,
  limitsForTier,
} from "@/lib/apiRateLimit";

export const config = {
  matcher: ["/api/:path*"],
};

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const tier = classifyApiPath(pathname);
  const limits = limitsForTier(tier);
  if (!limits) {
    return NextResponse.next();
  }

  const ip = getRequestClientIp(req.headers);
  const result = checkRateLimit({
    namespace: `mw:${tier}`,
    key: ip,
    limit: limits.limit,
    windowMs: limits.windowMs,
  });

  if (result.limited) {
    return NextResponse.json(
      { ok: false, error: "rate_limited", message: "Too many requests" },
      {
        status: 429,
        headers: {
          "Retry-After": String(result.retryAfterSec || 60),
          "Cache-Control": "no-store",
        },
      }
    );
  }

  const res = NextResponse.next();
  res.headers.set("X-RateLimit-Remaining", String(result.remaining));
  return res;
}
