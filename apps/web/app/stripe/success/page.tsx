"use client";

import { useAdminT } from "@/i18n/useAdminT";

export default function StripeSuccessPage() {
  const { t } = useAdminT();

  return (
    <div style={{ padding: 40 }}>
      <h1>✅ Paiement réussi</h1>
      <p>{t("Merci pour votre commande.")}</p>
      <p>{t("Votre paiement a bien été confirmé.")}</p>
    </div>
  );
}
