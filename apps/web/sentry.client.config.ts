import * as Sentry from "@sentry/nextjs";
import {
  createSentryBeforeSend,
  SENTRY_DENY_URLS,
  SENTRY_IGNORE_ERRORS,
} from "./src/lib/sentryFilter";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  sendDefaultPii: false,
  ignoreErrors: SENTRY_IGNORE_ERRORS,
  denyUrls: SENTRY_DENY_URLS,
  beforeSend: createSentryBeforeSend() as never,
});
