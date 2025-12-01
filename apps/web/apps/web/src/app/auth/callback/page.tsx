"use client";
import { useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

export default function AuthCallback() {
  const sp = useSearchParams();
  const router = useRouter();
  const next = sp.get("next") || "/";

  useEffect(() => {
    (async () => {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          console.error("exchangeCodeForSession error:", error.message);
        }
      } catch (e) {
        console.error(e);
      } finally {
        router.replace(next);
      }
    })();
  }, [router, next]);

  return <div className="p-6 text-sm">Connexion en cours…</div>;
}
