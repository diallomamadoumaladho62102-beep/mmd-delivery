"use client";

import { useAdminT } from "@/i18n/useAdminT";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export default function AuthBanner() {
  const { t } = useAdminT();

  const [authed, setAuthed] = useState<boolean>(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user);
    }).catch(() => setAuthed(true));
  }, []);

  if (authed) return null;
  return (
    <div className="border rounded p-3 bg-yellow-50 text-yellow-900 text-sm">
      {t("Tu n’es pas connecté. Connecte-toi pour rejoindre le chat et changer le statut.")}
    </div>
  );
}
