/**
 * Prevent accidental Live Stripe / real-money operations outside Production.
 * Secrets are never logged — only mode labels.
 */

export type PaymentRuntimeMode = "test" | "live" | "unknown";

export function detectStripeKeyMode(secretKey?: string | null): PaymentRuntimeMode {
  const key = String(secretKey ?? process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  if (key.startsWith("rk_live_")) return "live";
  if (key.startsWith("rk_test_")) return "test";
  return key ? "unknown" : "unknown";
}

export function isVercelProductionRuntime(): boolean {
  return String(process.env.VERCEL_ENV ?? "").trim() === "production";
}

export function isAppProductionEnv(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.MMD_APP_ENV ?? "")
    .trim()
    .toLowerCase();
  if (appEnv === "production" || appEnv === "prod") return true;
  return isVercelProductionRuntime();
}

export function assertStripeModeAllowed(context: string): {
  ok: true;
  mode: PaymentRuntimeMode;
} | { ok: false; mode: PaymentRuntimeMode; error: string } {
  const mode = detectStripeKeyMode();
  const prod = isAppProductionEnv();

  if (!prod && mode === "live") {
    return {
      ok: false,
      mode,
      error: `[MMD] Live Stripe key blocked outside production (${context}). Use sk_test_* on Preview/local.`,
    };
  }

  if (prod && mode === "test") {
    return {
      ok: false,
      mode,
      error: `[MMD] Test Stripe key blocked in production (${context}). Use sk_live_*.`,
    };
  }

  return { ok: true, mode };
}

export function stripeModeLabel(): string {
  const mode = detectStripeKeyMode();
  const env = isAppProductionEnv() ? "production" : "non-production";
  return `stripe_mode=${mode}; app_env=${env}`;
}
