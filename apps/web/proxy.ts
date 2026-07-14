import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  checkRateLimit,
  classifyApiPath,
  getRequestClientIp,
  limitsForTier,
} from "@/lib/apiRateLimit";
import {
  getSupabasePublishableKey,
  getSupabaseUrl,
} from "@/lib/supabaseEnv";

/**
 * Next.js 16 proxy (replaces middleware.ts).
 * - API rate limiting for money / webhook / location / auth-sensitive paths
 * - Restaurant web session gate (existing behavior)
 */
export async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  // --- API rate limiting (formerly middleware.ts) ---
  if (pathname.startsWith("/api/")) {
    const tier = classifyApiPath(pathname);
    const limits = limitsForTier(tier);
    if (!limits) {
      return NextResponse.next();
    }

    const ip = getRequestClientIp(req.headers);
    const result = checkRateLimit({
      namespace: `proxy:${tier}`,
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

  // --- Restaurant web auth gate (existing proxy behavior) ---
  const protect =
    pathname.startsWith("/restaurant") ||
    pathname.startsWith("/orders/restaurant") ||
    /\/orders\/[^/]+\/restaurant(?:\/|$)/.test(pathname);

  if (!protect) {
    return NextResponse.next();
  }

  const res = NextResponse.next();

  const supabase = createServerClient(
    getSupabaseUrl(),
    getSupabasePublishableKey(),
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: Record<string, unknown>) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: Record<string, unknown>) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/signup/restaurant";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (prof?.role !== "restaurant") {
    const url = req.nextUrl.clone();
    url.pathname = "/choose-role";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: [
    "/api/:path*",
    "/restaurant/:path*",
    "/orders/restaurant/:path*",
    "/orders/:orderId/restaurant",
    "/orders/:orderId/restaurant/:path*",
  ],
};
