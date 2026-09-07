"use client";


import { useAdminT } from "@/i18n/useAdminT";
import AdminGate from "@/components/AdminGate";
import AdminCommunicationPanel from "@/components/admin/AdminCommunicationPanel";

export default function AdminCommunicationPage() {
  const { t } = useAdminT();

  return (
    <AdminGate requiredPermission="communication.notify">
      <main className="space-y-6">
        <div className="mx-auto max-w-2xl space-y-6">
          <header>
            <h1 className="text-2xl font-bold text-slate-900">{t("Communication")}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {t("Envoyer push, SMS ou email — chaque envoi est tracé.")}
            </p>
          </header>
          <AdminCommunicationPanel />
        </div>
      </main>
    </AdminGate>
  );
}
