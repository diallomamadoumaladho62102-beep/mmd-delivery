import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(req: NextRequest) {
  const res = NextResponse.next();
  const pathname = req.nextUrl.pathname;

  const protect =
    pathname.startsWith("/restaurant") ||
    pathname.startsWith("/orders/restaurant");

  if (!protect) return res;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          res.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          res.cookies.set({ name, value: "", ...options });
        },
      },
    }
  );

  const { data: auth } = await supabase.auth.getUser();

  // Pas connecté => dehors direct (0 flash)
  if (!auth.user) {
    const url = req.nextUrl.clone();
    url.pathname = "/signup/restaurant";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Connecté mais pas restaurant => dehors
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
  matcher: ["/restaurant/:path*", "/orders/restaurant/:path*"],
};