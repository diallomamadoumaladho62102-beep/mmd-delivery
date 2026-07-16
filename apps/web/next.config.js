const path = require("node:path");
const { withSentryConfig } = require("@sentry/nextjs");

/** Keep in sync with src/lib/securityHeaders.ts */
const MMD_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(self), payment=(self)",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob: https:",
      "font-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline' https:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.sentry.io",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/render/**",
      },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  allowedDevOrigins: [
    "http://192.168.1.203:3000",
    "http://192.168.1.204:3000",
    "http://192.168.1.203:8081",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: MMD_SECURITY_HEADERS,
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

const withAnalyzer = (() => {
  if (process.env.ANALYZE !== "true") return (config) => config;
  try {
    return require("@next/bundle-analyzer")({ enabled: true });
  } catch {
    console.warn(
      "[next.config] ANALYZE=true but @next/bundle-analyzer is not installed; skipping analyzer."
    );
    return (config) => config;
  }
})();

module.exports = withSentryConfig(withAnalyzer(nextConfig), {
  // Build-time source map upload + release creation require both org and
  // project; @sentry/nextjs silently skips the upload otherwise, even when
  // SENTRY_AUTH_TOKEN is set. Official Sentry slugs (org "mmd-delivery"):
  // web project = "mmd-delivery-web". Kept env-overridable for flexibility.
  org: process.env.SENTRY_ORG || "mmd-delivery",
  project: process.env.SENTRY_PROJECT || "mmd-delivery-web",
  silent: true,
  disableLogger: true,
  // Upload source maps only when SENTRY_AUTH_TOKEN is present (CI/Vercel).
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
