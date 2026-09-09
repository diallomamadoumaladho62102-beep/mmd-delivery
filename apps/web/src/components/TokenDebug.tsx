"use client";


import { useAdminT } from "@/i18n/useAdminT";
import { supabase } from "@/lib/supabaseBrowser";
import { useState } from "react";

export default function TokenDebug() {
  const { t } = useAdminT();

  const [token, setToken] = useState("");

  async function getToken() {
    const { data } = await supabase.auth.getSession();
    setToken(data.session?.access_token ?? "NO_SESSION");
  }

  return (
    <div style={{ padding: 12 }}>
      <button onClick={getToken}>{t("Show Access Token")}</button>
      <pre>{token}</pre>
    </div>
  );
}