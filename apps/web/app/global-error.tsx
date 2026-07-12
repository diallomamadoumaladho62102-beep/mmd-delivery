"use client";

import { useEffect } from "react";
import { captureProductionException } from "@/lib/sentryCapture";

/**
 * Root global error boundary (replaces the whole document on a fatal render
 * error). Reports to Sentry and shows a minimal, self-contained fallback so
 * the user is never left on a blank white screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureProductionException("web.global_error_boundary", error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc" }}>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h2 style={{ color: "#0f172a", fontSize: 20, fontWeight: 600 }}>
            Une erreur inattendue est survenue
          </h2>
          <p style={{ color: "#475569", fontSize: 14, maxWidth: 420 }}>
            L’application a rencontré un problème. Vous pouvez recharger la page.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              background: "#0f172a",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 14,
              cursor: "pointer",
            }}
          >
            Recharger
          </button>
        </div>
      </body>
    </html>
  );
}
