/**
 * Canonical browser security headers for MMD Delivery web.
 * Applied via next.config.js headers() for all routes.
 */

export const MMD_SECURITY_HEADERS = [
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
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // CSP: allow app origins + Supabase + Stripe + Mapbox + Sentry + Expo push hosts.
  // 'unsafe-inline'/'unsafe-eval' kept minimal for Next.js runtime; tighten later with nonces.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "img-src 'self' data: blob: https://*.supabase.co https://*.mapbox.com https://api.mapbox.com https://images.unsplash.com https://lh3.googleusercontent.com https://*.stripe.com",
      "media-src 'self' blob: https://*.supabase.co https://media.twiliocdn.com https://*.twilio.com",
      "font-src 'self' data: https://api.mapbox.com",
      "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://*.sentry.io",
      "connect-src 'self' https: wss:",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
      "worker-src 'self' blob:",
      "upgrade-insecure-requests",
    ].join("; "),
  },
] as const;

export function securityHeaderMap(): Record<string, string> {
  return Object.fromEntries(
    MMD_SECURITY_HEADERS.map((header) => [header.key, header.value])
  );
}
