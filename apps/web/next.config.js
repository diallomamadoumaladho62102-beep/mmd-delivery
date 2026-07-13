const path = require("node:path");
const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.resolve(__dirname, "..", ".."),
  },
  allowedDevOrigins: [
    "http://192.168.1.203:3000",
    "http://192.168.1.204:3000",
    "http://192.168.1.203:8081",
  ],
};

module.exports = withSentryConfig(nextConfig, {
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
