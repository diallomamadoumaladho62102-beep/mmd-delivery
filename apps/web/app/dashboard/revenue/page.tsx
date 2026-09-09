"use client";

import { useAdminT } from "@/i18n/useAdminT";
import RevenueSummary from "@/components/RevenueSummary";

export default function RevenuePage() {
  const { t } = useAdminT();

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t("Revenus plateforme")}</h1>
      <p className="text-sm text-gray-600">
        {t("Total des commissions (client + driver + restaurant) selon notre modèle 25%.")}
      </p>
      <RevenueSummary />
    </main>
  );
}

