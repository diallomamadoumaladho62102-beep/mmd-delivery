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
  silent: true,
  disableLogger: true,
  // Upload source maps only when SENTRY_AUTH_TOKEN is present (CI/Vercel).
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
