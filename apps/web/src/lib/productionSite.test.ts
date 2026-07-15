import {
  CANONICAL_SITE_ORIGIN,
  LEGACY_VERCEL_SITE_ORIGIN,
  PublicSiteOriginError,
  buildStripeCheckoutReturnUrls,
  buildStripeConnectReturnUrls,
  getDeploymentSurface,
  isLegacyVercelOrigin,
  resolvePublicSiteOrigin,
  type PublicSiteEnv,
} from "./productionSite";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => void, includes: string) {
  try {
    fn();
    throw new Error(`expected throw containing "${includes}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("expected throw") || !message.includes(includes)) {
      throw new Error(`Expected error containing "${includes}", got "${message}"`);
    }
  }
}

console.log("productionSite tests");

assert(
  getDeploymentSurface({ VERCEL_ENV: "production" }) === "production",
  "vercel production surface",
);
assert(
  getDeploymentSurface({ VERCEL_ENV: "preview" }) === "preview",
  "vercel preview surface",
);
assert(
  getDeploymentSurface({ NODE_ENV: "development" }) === "local",
  "local surface",
);

// Production → www.mmddelivery.com (never VERCEL_URL)
{
  const env: PublicSiteEnv = {
    VERCEL_ENV: "production",
    VERCEL_URL: "mmd-delivery.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "mmd-delivery.vercel.app",
    NEXT_PUBLIC_SITE_URL: "",
    NEXT_PUBLIC_WEB_BASE_URL: "",
  };
  const origin = resolvePublicSiteOrigin(env);
  assert(origin === CANONICAL_SITE_ORIGIN, `prod origin got ${origin}`);
  assert(!origin.includes("vercel.app"), "prod must not use vercel.app");
}

// Preview → Preview URL
{
  const env: PublicSiteEnv = {
    VERCEL_ENV: "preview",
    VERCEL_URL: "mmd-delivery-git-feature-team.vercel.app",
  };
  const origin = resolvePublicSiteOrigin(env);
  assert(
    origin === "https://mmd-delivery-git-feature-team.vercel.app",
    `preview origin got ${origin}`,
  );
}

// local → localhost
{
  const origin = resolvePublicSiteOrigin({
    NODE_ENV: "development",
  });
  assert(origin === "http://localhost:3000", `local origin got ${origin}`);
}

// aucune variable explicite + NODE_ENV=production → fail-closed
{
  assertThrows(
    () =>
      resolvePublicSiteOrigin({
        NODE_ENV: "production",
      }),
    "Missing public site base URL in production",
  );
  assertThrows(
    () =>
      resolvePublicSiteOrigin({
        NODE_ENV: "production",
        VERCEL_URL: "mmd-delivery.vercel.app",
      }),
    "Missing public site base URL in production",
  );
}

// success_url / cancel_url correctes en Production
{
  const urls = buildStripeCheckoutReturnUrls({
    successQuery: { orderId: "abc" },
    cancelQuery: { orderId: "abc" },
    env: {
      VERCEL_ENV: "production",
      VERCEL_URL: "mmd-delivery.vercel.app",
      STRIPE_CHECKOUT_SUCCESS_URL: "",
      STRIPE_CHECKOUT_CANCEL_URL: "",
    },
  });
  assert(
    urls.successUrl.startsWith(`${CANONICAL_SITE_ORIGIN}/stripe/success`),
    `success_url ${urls.successUrl}`,
  );
  assert(
    urls.cancelUrl.startsWith(`${CANONICAL_SITE_ORIGIN}/stripe/cancel`),
    `cancel_url ${urls.cancelUrl}`,
  );
  assert(urls.successUrl.includes("orderId=abc"), "success query");
  assert(urls.cancelUrl.includes("orderId=abc"), "cancel query");
}

// Override legacy vercel.app rewritten in production
{
  const urls = buildStripeCheckoutReturnUrls({
    successQuery: { orderId: "xyz" },
    cancelQuery: { orderId: "xyz" },
    env: {
      VERCEL_ENV: "production",
      STRIPE_CHECKOUT_SUCCESS_URL: `${LEGACY_VERCEL_SITE_ORIGIN}/stripe/success`,
      STRIPE_CHECKOUT_CANCEL_URL: `${LEGACY_VERCEL_SITE_ORIGIN}/stripe/cancel`,
    },
  });
  assert(
    urls.successUrl.startsWith(`${CANONICAL_SITE_ORIGIN}/stripe/success`),
    `rewritten success ${urls.successUrl}`,
  );
  assert(
    urls.cancelUrl.startsWith(`${CANONICAL_SITE_ORIGIN}/stripe/cancel`),
    `rewritten cancel ${urls.cancelUrl}`,
  );
}

// Connect return_url / refresh_url correctes
{
  const urls = buildStripeConnectReturnUrls({
    VERCEL_ENV: "production",
    VERCEL_URL: "mmd-delivery.vercel.app",
  });
  assert(
    urls.returnUrl.startsWith(`${CANONICAL_SITE_ORIGIN}/stripe/return`),
    `return_url ${urls.returnUrl}`,
  );
  assert(
    urls.refreshUrl.startsWith(`${CANONICAL_SITE_ORIGIN}/stripe/refresh`),
    `refresh_url ${urls.refreshUrl}`,
  );
}

assert(isLegacyVercelOrigin(LEGACY_VERCEL_SITE_ORIGIN), "legacy detect");
assert(!isLegacyVercelOrigin(CANONICAL_SITE_ORIGIN), "canonical not legacy");

assertThrows(() => {
  throw new PublicSiteOriginError("boom");
}, "boom");

console.log("productionSite tests passed");
