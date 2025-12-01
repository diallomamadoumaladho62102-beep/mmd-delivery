"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import CommissionSummary from "@/components/CommissionSummary";

type Profile = { id: string; role: string; is_admin?: boolean | null };

export default function AdminOnlyCommission({ orderId }: { orderId: string }) {
  const [me, setMe] = useState<Profile | null>(null);
  const [isMember, setIsMember] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) { setLoading(false); return; }

      const [{ data: prof }, { data: mem }] = await Promise.all([
        supabase.from("profiles").select("id, role, is_admin").eq("id", uid).maybeSingle(),
        supabase.from("order_members").select("id").eq("order_id", orderId).eq("user_id", uid).maybeSingle(),
      ]);

      setMe(prof as any);
      setIsMember(!!mem);
      setLoading(false);
    })();
  }, [orderId]);

  if (loading) return null;

  const isRestaurant = me?.role === "restaurant";

  // 👉 Commissions visibles uniquement au RESTAURANT membre
  if (!(isRestaurant && isMember)) return null;

  return <CommissionSummary orderId={orderId} />;
}
