"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useEffect } from "react";
import { supabase } from "@/lib/supabaseBrowser";
import { assignInternalRedirect } from "@/lib/authValidation";

export default function SignOut() {
  const { t } = useAdminT();

  useEffect(() => {
    (async () => {
      const { error } = await supabase.auth.signOut();
      if (error) console.error("sign out failed");
      try {
        localStorage.removeItem("supabase.auth.token");
        sessionStorage.clear();
      } catch {
        console.error("local session cleanup failed");
      }
      assignInternalRedirect("/");
    })();
  }, []);
  return <div className="p-4">{t("Déconnexion…")}</div>;
}

