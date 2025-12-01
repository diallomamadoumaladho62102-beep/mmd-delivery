"use client";
import RevenueSummary from "@/components/RevenueSummary";

export default function RevenuePage() {
  return (
    <main className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Revenus plateforme</h1>
      <p className="text-sm text-gray-600">
        Total des commissions (client + driver + restaurant) selon notre modèle 25%.
      </p>
      <RevenueSummary />
    </main>
  );
}

