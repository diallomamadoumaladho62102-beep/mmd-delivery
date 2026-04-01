"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseBrowser";

export default function CallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<
    "loading" | "success" | "error"
  >("loading");
  const [message, setMessage] = useState("Connexion en cours…");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const next = params.get("next") || "/auth/whoami";

        // Finalise la session depuis l’URL (OAuth / magic link)
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (cancelled) return;

        if (data.session) {
          setStatus("success");
          setMessage("Connecté ✅ Redirection…");
        } else {
          // Pas de session détectée → on redirige quand même vers whoami/login
          setStatus("error");
          setMessage("Session introuvable. Redirection…");
        }

        router.replace(next);
      } catch (e: any) {
        console.error("Auth callback error:", e);
        if (cancelled) return;

        setStatus("error");
        setMessage("Erreur de connexion. Redirection…");
        router.replace("/auth/login");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, params]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-lg border bg-white p-4 space-y-2">
        <div className="text-lg font-semibold">
          {status === "loading" && "Authentification"}
          {status === "success" && "Bienvenue"}
          {status === "error" && "Oups"}
        </div>
        <div className="text-sm text-gray-600">{message}</div>
        <div className="h-2 rounded bg-gray-100 overflow-hidden">
          <div className="h-full w-2/3 bg-black animate-pulse" />
        </div>
      </div>
    </main>
  );
}