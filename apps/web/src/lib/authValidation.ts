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
  let raw = String(next ?? "").trim();
  if (!raw) return fallback;

  // Decode once to catch %2f%2fevil and nested encodings, then re-validate.
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  raw = raw.trim();

  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\") || raw.includes("\0")) return fallback;
  if (raw.includes("://")) return fallback;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return fallback;

  // Collapse accidental "/\/" style and reject protocol-relative after normalize.
  const normalized = raw.replace(/\\/g, "/");
  if (normalized.startsWith("//") || normalized.includes("///")) return fallback;

  // Strip nested open-redirect payloads in query (e.g. ?next=//evil).
  const qIndex = normalized.indexOf("?");
  if (qIndex >= 0) {
    const pathOnly = normalized.slice(0, qIndex);
    const query = normalized.slice(qIndex + 1);
    const params = new URLSearchParams(query);
    if (params.has("next") || params.has("redirect") || params.has("returnTo")) {
      const nestedKey = params.has("next")
        ? "next"
        : params.has("redirect")
          ? "redirect"
          : "returnTo";
      const nested = params.get(nestedKey);
      const safeNested = sanitizeInternalRedirectPath(nested, "");
      if (!safeNested) {
        // Drop nested open-redirect params entirely.
        params.delete("next");
        params.delete("redirect");
        params.delete("returnTo");
        const rest = params.toString();
        return rest ? `${pathOnly}?${rest}` : pathOnly || fallback;
      }
      params.set(nestedKey, safeNested);
      const rebuilt = `${pathOnly}?${params.toString()}`;
      return rebuilt.startsWith("/") ? rebuilt : fallback;
    }
  }

  return normalized;
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
