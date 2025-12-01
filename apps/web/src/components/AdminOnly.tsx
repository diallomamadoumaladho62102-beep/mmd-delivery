"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let on = true;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id || null;
      if (!uid) { on && setAllowed(false); on && setLoading(false); return; }
      const { data } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", uid)
        .maybeSingle();
      if (on) { setAllowed(!!data?.is_admin); setLoading(false); }
    })();
    return () => { on = false; };
  }, []);

  if (loading) return <div className="p-6 text-sm text-gray-500">Chargement…</div>;
  if (!allowed) {
    return (
      <div className="max-w-xl mx-auto p-6 border rounded-xl">
        <div className="text-lg font-semibold mb-1">Accès refusé</div>
        <div className="text-sm text-gray-600">Cette section est réservée aux administrateurs.</div>
      </div>
    );
  }
  return <>{children}</>;
}
