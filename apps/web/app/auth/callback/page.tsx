"use client";

import { Suspense } from "react";
import { useAdminT } from "@/i18n/useAdminT";
import CallbackClient from "./CallbackClient";

export const dynamic = "force-dynamic";

export default function Page() {
  const { t } = useAdminT();

  return (
    <Suspense fallback={<main className="p-6">{t("Connexion en cours…")}</main>}>
      <CallbackClient />
    </Suspense>
  );
}
