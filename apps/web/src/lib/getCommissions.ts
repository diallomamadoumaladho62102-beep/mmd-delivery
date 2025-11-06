import { createClient } from "@supabase/supabase-js";
import type { Commission } from "@/components/CommissionBreakdown";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
if (!url || !anon) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY manquants");
}

// Client serveur simple, sans cookies
const supabase = createClient(url, anon, { auth: { persistSession: false } });

export async function getCommissions(orderId: string): Promise<Commission | null> {
  // s'assurer que le refresh a tourné au moins une fois
  await supabase.rpc("refresh_order_commissions", { p_order_id: orderId });

  const { data, error } = await supabase
    .from("order_commissions")
    .select("currency, client_fee, driver_fee, restaurant_fee, platform_total")
    .eq("order_id", orderId)
    .single();

  if (error) return null;
  return data as Commission;
}
