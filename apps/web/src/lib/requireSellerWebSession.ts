import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export type SellerWebSession = {
  userId: string;
  sellerId: string;
  supabase: SupabaseClient;
  admin: SupabaseClient;
};

async function createCookieSupabase() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
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

export async function requireSellerWebSession(): Promise<SellerWebSession> {
  const supabase = await createCookieSupabase();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth.user) {
    redirect("/login");
  }

  const userId = auth.user.id;
  const admin = buildSupabaseAdminClient();

  const { data: seller } = await admin
    .from("sellers")
    .select("id, status")
    .eq("user_id", userId)
    .maybeSingle();

  if (!seller?.id) {
    redirect("/seller");
  }

  const status = String(seller.status ?? "").toLowerCase();
  if (status !== "approved") {
    redirect("/seller");
  }

  return { userId, sellerId: String(seller.id), supabase, admin };
}
