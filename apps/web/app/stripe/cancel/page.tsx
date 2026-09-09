"use client";

import { useAdminT } from "@/i18n/useAdminT";

export default function StripeCancelPage() {
  const { t } = useAdminT();

  return (
    <div style={{ padding: 40 }}>
      <h1>❌ Paiement annulé</h1>
      <p>{t("Le paiement a été annulé.")}</p>
      <p>{t("Vous pouvez réessayer à tout moment.")}</p>
    </div>
  );
}
