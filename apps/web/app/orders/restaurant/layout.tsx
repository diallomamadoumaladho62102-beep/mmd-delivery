import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

export default async function OrdersRestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();

  const supabase = createServerClient(
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
    }
  );

  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    redirect("/auth/login");
  }

  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (prof?.role !== "restaurant") {
    redirect("/signup");
  }

  const { data: restaurantProfile } = await supabase
    .from("restaurant_profiles")
    .select("restaurant_name, status")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!restaurantProfile?.restaurant_name) {
    redirect("/restaurant/profile");
  }

  if (restaurantProfile.status !== "approved") {
    redirect("/restaurant/profile");
  }

  return <>{children}</>;
}