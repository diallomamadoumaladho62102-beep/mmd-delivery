"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

export default function Callback() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    (async () => {
      await supabase.auth.getSession(); // finalise la session depuis l’URL
      router.replace(params.get("next") || "/auth/whoami"); // redirige vers whoami pour vérifier
    })();
  }, [router, params]);

  return <main className="p-6">Connexion en cours…</main>;
}

