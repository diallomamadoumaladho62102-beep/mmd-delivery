"use client";

/**
 * Optional Web Vitals reporter — loads web-vitals only if the package is present.
 * Never throws; never changes UI behavior.
 */
import { useEffect } from "react";

export default function WebVitalsReporter() {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import("web-vitals").catch(() => null);
        if (!mod || cancelled) return;
        const send = (metric: { name: string; value: number }) => {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[web-vitals]", metric.name, Math.round(metric.value));
          }
        };
        mod.onLCP?.(send);
        mod.onINP?.(send);
        mod.onCLS?.(send);
        mod.onTTFB?.(send);
        mod.onFCP?.(send);
      } catch {
        // Package optional — budgets covered by lighthouse smoke + unit tests.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
