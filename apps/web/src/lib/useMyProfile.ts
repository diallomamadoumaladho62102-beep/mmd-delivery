"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

type Profile = { id: string; role?: string | null; vendor_id?: string | null; driver_id?: string | null };

export function useMyProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        setLoading(true);
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id;
        if (!uid) { if (!stop) setProfile(null); return; }
        // Adapte le SELECT à ton schéma (role, vendor_id, driver_id…)
        const { data } = await supabase
          .from("profiles")
          .select("id, role, vendor_id, driver_id")
          .eq("id", uid)
          .single();
        if (!stop) setProfile((data as any) ?? null);
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => { stop = true; };
  }, []);

  return { profile, loading };
}
