"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

export default function WhoAmIPage() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 0));

        let { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!data.session) {
          const refreshed = await supabase.auth.refreshSession();
          if (refreshed.error) throw refreshed.error;
          data = refreshed.data;
        }

        if (!alive) return;

        router.replace(data.session ? "/dashboard" : "/auth");
      } catch {
        if (!alive) return;
        router.replace("/auth");
      }
    })();

    return () => {
      alive = false;
    };
  }, [router]);

  return (
    <main className="flex min-h-[50vh] items-center justify-center p-6 text-sm text-slate-600">
      Finalisation de la connexion…
    </main>
  );
}
