"use client";

import CreateErrandOrderForm from "@/components/CreateErrandOrderForm";
import { useAdminT } from "@/i18n/useAdminT";

export default function Page() {
  const { t } = useAdminT();

  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">{t("Créer une commande")}</h1>
      <CreateErrandOrderForm />
    </main>
  );
}

