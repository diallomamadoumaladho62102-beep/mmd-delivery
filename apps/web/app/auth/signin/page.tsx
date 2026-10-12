"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { assignInternalRedirect, sanitizeInternalRedirectPath } from "@/lib/authValidation";

function readNextPath(): string {
  if (typeof window === "undefined") return "/dashboard";
  const next = new URLSearchParams(window.location.search).get("next");
  return sanitizeInternalRedirectPath(next, "/dashboard");
}

export default function SignInPage() {
  const { t } = useAdminT();

  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted || !data.session) return;
      assignInternalRedirect(readNextPath());
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null); setLoading(true);
    const nextPath = readNextPath();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}` },
    });
    setLoading(false);
    setMsg(error ? `❌ ${error.message}` : "📩 Lien magique envoyé. Vérifie tes emails.");
  }

  return (
    <main className="p-6 max-w-sm mx-auto space-y-4">
      <h1 className="text-xl font-semibold">{t("Se connecter")}</h1>
      <form onSubmit={onSubmit} className="space-y-3">
        <input className="border rounded px-3 py-2 w-full" type="email" required value={email}
               onChange={e=>setEmail(e.target.value)} placeholder="vous@email.com" />
        <button className="border rounded px-3 py-2 w-full" disabled={loading}>
          {loading ? t("Envoi...") : t("Envoyer le lien magique")}
        </button>
      </form>
      {msg && <p className="text-sm">{msg}</p>}
    </main>
  );
}

