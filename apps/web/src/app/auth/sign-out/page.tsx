"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function SignOut() {
  useEffect(() => {
    (async () => {
      try { await supabase.auth.signOut(); } catch {}
      // Nettoyage local (au cas où)
      try {
        localStorage.removeItem("supabase.auth.token");
        sessionStorage.clear();
      } catch {}
      window.location.href = "/auth/whoami";
    })();
  }, []);
  return <div className="p-4">Déconnexion…</div>;
}

