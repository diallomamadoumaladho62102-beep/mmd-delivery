import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type RestaurantWebSession = {
  userId: string;
  supabase: SupabaseClient;
  admin: SupabaseClient;
};

async function createCookieSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set() {},
        remove() {},
      },
    },
  );
}

export async function requireRestaurantWebSession(options?: {
  orderId?: string;
}): Promise<RestaurantWebSession> {
  const supabase = await createCookieSupabase();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    redirect("/signup/restaurant");
  }

  const userId = auth.user.id;

  const { data: prof } = await supabase
    .from("profiles")
    .select("role, account_status")
    .eq("id", userId)
    .maybeSingle();

  if (prof?.role !== "restaurant") {
    redirect("/choose-role");
  }

  if (prof?.account_status && prof.account_status !== "active") {
    redirect("/auth/sign-in");
  }

  const { data: restaurantProfile } = await supabase
    .from("restaurant_profiles")
    .select("restaurant_name, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (!restaurantProfile?.restaurant_name) {
    redirect("/restaurant/profile");
  }

  const restaurantStatus = String(restaurantProfile.status ?? "").toLowerCase();
  if (restaurantStatus !== "approved") {
    redirect("/restaurant/profile");
  }

  const admin = buildSupabaseAdminClient();

  if (options?.orderId) {
    const orderId = String(options.orderId).trim();
    if (!orderId) {
      redirect("/orders/restaurant");
    }

    const { data: order, error } = await admin
      .from("orders")
      .select("id, restaurant_id, restaurant_user_id, kind, payment_status")
      .eq("id", orderId)
      .maybeSingle();

    if (error || !order) {
      redirect("/orders/restaurant");
    }

    const ownsOrder =
      order.restaurant_id === userId || order.restaurant_user_id === userId;

    if (!ownsOrder) {
      redirect("/orders/restaurant");
    }
  }

  return { userId, supabase, admin };
}
