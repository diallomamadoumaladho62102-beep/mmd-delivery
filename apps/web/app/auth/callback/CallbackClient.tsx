"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminT } from "@/i18n/useAdminT";
import { supabase } from "@/lib/supabaseBrowser";
import {
  sanitizeInternalRedirectPath,
} from "@/lib/authValidation";

export default function CallbackClient() {
  const { t } = useAdminT();
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<
    "loading" | "success" | "error"
  >("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const next = sanitizeInternalRedirectPath(params.get("next"), "/dashboard");
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

        if (cancelled) return;

        if (data.session) {
          setStatus("success");
          setMessage(t("Connecté ✅ Redirection…"));
        } else {
          setStatus("error");
          setMessage(t("Session introuvable. Redirection…"));
        }

        router.replace(next);
      } catch (e: unknown) {
        console.error("Auth callback error:", e);
        if (cancelled) return;

        setStatus("error");
        setMessage(t("Erreur de connexion. Redirection…"));
        router.replace("/auth");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, params, t]);

  return (
    <main className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-lg border bg-white p-4 space-y-2">
        <div className="text-lg font-semibold">
          {status === "loading" && t("Authentification")}
          {status === "success" && t("Bienvenue")}
          {status === "error" && t("Oups")}
        </div>
        <div className="text-sm text-gray-600">
          {message || t("Connexion en cours…")}
        </div>
        <div className="h-2 rounded bg-gray-100 overflow-hidden">
          <div className="h-full w-2/3 bg-black animate-pulse" />
        </div>
      </div>
    </main>
  );
}
