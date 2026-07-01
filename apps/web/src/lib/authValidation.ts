export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): string | null {
  const value = String(password ?? "");
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/** Allow only same-origin relative paths (blocks open redirects). */
export function sanitizeInternalRedirectPath(
  next: string | null | undefined,
  fallback = "/dashboard",
): string {
  const raw = String(next ?? "").trim();
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return fallback;
  return raw;
}

export function isEmailVerificationRequired(): boolean {
  return ["true", "1", "yes"].includes(
    String(process.env.REQUIRE_EMAIL_VERIFICATION ?? "").trim().toLowerCase(),
  );
}

export function isUserEmailVerified(user: {
  email_confirmed_at?: string | null;
} | null | undefined): boolean {
  return Boolean(user?.email_confirmed_at);
}
