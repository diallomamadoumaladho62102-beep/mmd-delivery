import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";

export default async function OrdersRestaurantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ✅ Next 16: cookies() est async
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

  // Pas connecté => redirect AVANT rendu => zéro flash
  if (!auth.user) {
    redirect("/signup/restaurant");
  }

  // Optionnel: check role restaurant
  const { data: prof } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (prof?.role && prof.role !== "restaurant") {
    redirect("/choose-role");
  }

  return <>{children}</>;
}