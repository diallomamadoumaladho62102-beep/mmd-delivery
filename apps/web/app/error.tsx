"use client";

import { useEffect } from "react";
import { captureProductionException } from "@/lib/sentryCapture";

/**
 * Segment-level error boundary: catches render/runtime errors in a route
 * subtree, reports to Sentry with context, and offers a recovery action
 * instead of crashing the whole app.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureProductionException("web.route_error_boundary", error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold text-slate-900">Une erreur est survenue</h2>
      <p className="text-sm text-slate-600">
        Cette section a rencontré un problème. Vous pouvez réessayer ou revenir à l’accueil.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Réessayer
        </button>
        <a
          href="/"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
        >
          Accueil
        </a>
      </div>
    </div>
  );
}
