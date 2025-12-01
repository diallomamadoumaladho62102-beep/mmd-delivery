import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export function useOrderMembership(orderId: string | null, userId: string | null) {
  const [role, setRole] = useState<string | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orderId || !userId) {
      setRole(null);
      setIsMember(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadMembership() {
      setLoading(true);

      const { data, error } = await supabase
        .from("order_members")
        .select("role")
        .eq("order_id", orderId)
        .eq("user_id", userId);

      if (cancelled) return;

      if (error) {
        setRole(null);
        setIsMember(false);
        setLoading(false);
        return;
      }

      if (data && data.length > 0) {
        const roles = data.map((r) => r.role);

        let finalRole = null;
        if (roles.includes("client")) finalRole = "client";
        else if (roles.includes("restaurant")) finalRole = "restaurant";
        else if (roles.includes("driver")) finalRole = "driver";

        setRole(finalRole);
        setIsMember(true);
      } else {
        setRole(null);
        setIsMember(false);
      }

      setLoading(false);
    }

    loadMembership();
    return () => {
      cancelled = true;
    };
  }, [orderId, userId]);

  return { role, isMember, loading };
}