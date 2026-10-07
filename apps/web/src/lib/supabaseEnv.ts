/**
 * Supabase API key resolution for Next.js (web + API routes).
 *
 * Browser clients use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY only.
 * Privileged server clients use SUPABASE_SECRET_KEY only.
 * Legacy JWT key names are not read. They stay enabled in Supabase until
 * the published mobile binary no longer needs the legacy anon key.
 *
 * Never put sb_secret_* in NEXT_PUBLIC_* variables.
 */

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
  return "";
}

export function getSupabaseUrl(): string {
  const url = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_URL
  );
  if (!url) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)");
  }
  return url;
}

function isSecretApiKey(key: string): boolean {
  return key.startsWith("sb_") && key.indexOf("secret_") === 3;
}

/** Public / browser / user-scoped clients. */
export function getSupabasePublishableKey(): string {
  const key = firstNonEmpty(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  if (!key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }
  if (isSecretApiKey(key)) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must not be a secret key"
    );
  }
  return key;
}

/**
 * Server-only privileged clients (sb_secret_* preferred).
 * Must never be read from NEXT_PUBLIC_* / EXPO_PUBLIC_*.
 */
export function getSupabaseSecretKey(): string {
  const key = firstNonEmpty(process.env.SUPABASE_SECRET_KEY);
  if (!key) {
    throw new Error("Missing SUPABASE_SECRET_KEY");
  }
  if (key.startsWith("sb_publishable_")) {
    throw new Error("SUPABASE_SECRET_KEY must not be a publishable key");
  }
  return key;
}

export function getSupabaseUrlOptional(): string | null {
  try {
    return getSupabaseUrl();
  } catch {
    return null;
  }
}

export function getSupabasePublishableKeyOptional(): string | null {
  try {
    return getSupabasePublishableKey();
  } catch {
    return null;
  }
}

export function getSupabaseSecretKeyOptional(): string | null {
  try {
    return getSupabaseSecretKey();
  } catch {
    return null;
  }
}
