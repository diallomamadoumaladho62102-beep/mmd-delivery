"use client";

import Link from "next/link";

/**
 * Stripe Connect Account Link return_url landing.
 * Drivers finish onboarding in Stripe then land here; deep-link back to the app when possible.
 */
export default function StripeConnectReturnPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">Stripe Connect</h1>
      <p className="text-slate-600">
        Votre configuration Stripe est enregistrée. Vous pouvez revenir dans l&apos;application
        MMD Delivery pour vérifier le statut de vos virements.
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          href="mmddelivery://wallet"
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white"
        >
          Ouvrir l&apos;application
        </a>
        <Link href="/" className="rounded border px-4 py-2 text-sm text-slate-800">
          Accueil web
        </Link>
      </div>
    </main>
  );
}
