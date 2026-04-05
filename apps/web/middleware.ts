import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { canAccessAdmin, normalizeUserRole } from "@/lib/roles";

/**
 * ROUTE DETECTION
 */
function isAdminPageRoute(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isAdminApiRoute(pathname: string): boolean {
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

function isProtectedAdminRoute(pathname: string): boolean {
  return isAdminPageRoute(pathname) || isAdminApiRoute(pathname);
}

/**
 * HELPERS
 */
function buildNextParam(request: NextRequest): string {
  const { pathname, search } = request.nextUrl;
  return `${pathname}${search}`;
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("next", buildNextParam(request));
  return NextResponse.redirect(loginUrl);
}

function redirectToForbiddenHome(request: NextRequest): NextResponse {
  const homeUrl = new URL("/", request.url);
  homeUrl.searchParams.set("forbidden", "admin");
  return NextResponse.redirect(homeUrl);
}

/**
 * RESPONSE STRATEGY (API vs PAGE)
 */
function buildUnauthorizedResponse(request: NextRequest): NextResponse {
  if (isAdminApiRoute(request.nextUrl.pathname)) {
    return jsonError("Unauthorized", 401);
  }
  return redirectToLogin(request);
}

function buildForbiddenResponse(request: NextRequest): NextResponse {
  if (isAdminApiRoute(request.nextUrl.pathname)) {
    return jsonError("Forbidden", 403);
  }
  return redirectToForbiddenHome(request);
}

function buildInitializationFailureResponse(request: NextRequest): NextResponse {
  if (isAdminApiRoute(request.nextUrl.pathname)) {
    return jsonError("Admin middleware initialization failed", 500);
  }
  return redirectToForbiddenHome(request);
}

/**
 * SUPABASE CLIENT (SSR SAFE)
 */
function buildSupabaseMiddlewareClient(request: NextRequest) {
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase env variables in middleware.");
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll().map(({ name, value }) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  return { supabase, response };
}

/**
 * MAIN MIDDLEWARE
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ⛔ Skip non-admin routes
  if (!isProtectedAdminRoute(pathname)) {
    return NextResponse.next();
  }

  let supabaseClient: ReturnType<typeof buildSupabaseMiddlewareClient>;

  try {
    supabaseClient = buildSupabaseMiddlewareClient(request);
  } catch (error) {
    console.error("[middleware:init_failed]", {
      pathname,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return buildInitializationFailureResponse(request);
  }

  const { supabase, response } = supabaseClient;

  /**
   * AUTH CHECK
   */
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    if (userError) {
      console.warn("[middleware:getUser_failed]", {
        pathname,
        error: userError.message,
      });
    }
    return buildUnauthorizedResponse(request);
  }

  /**
   * PROFILE CHECK
   */
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.warn("[middleware:profile_error]", {
      pathname,
      userId: user.id,
      error: profileError.message,
    });
    return buildForbiddenResponse(request);
  }

  if (!profile) {
    console.warn("[middleware:missing_profile]", {
      pathname,
      userId: user.id,
    });
    return buildForbiddenResponse(request);
  }

  /**
   * ROLE CHECK (SECURE)
   */
  const role = normalizeUserRole(profile.role);

  if (!canAccessAdmin(role)) {
    console.warn("[middleware:access_denied]", {
      pathname,
      userId: user.id,
      role,
    });
    return buildForbiddenResponse(request);
  }

  /**
   * SUCCESS
   */
  return response;
}

/**
 * MATCHER
 */
export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin", "/api/admin/:path*"],
};