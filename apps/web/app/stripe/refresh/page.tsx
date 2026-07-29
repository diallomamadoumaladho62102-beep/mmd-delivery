"use client";

import Link from "next/link";

/**
 * Stripe Connect Account Link refresh_url landing.
 * Used when an Account Link expires; driver can restart onboarding from the app.
 */
export default function StripeConnectRefreshPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">Lien Stripe expiré</h1>
      <p className="text-slate-600">
        Ce lien d&apos;onboarding a expiré. Rouvrez Wallet → Enable dans l&apos;application MMD
        Delivery pour générer un nouveau lien sécurisé.
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
