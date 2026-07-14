/**
 * Supabase API key resolution for Next.js (web + API routes).
 *
 * Prefer new platform keys; fall back to legacy JWT names only temporarily
 * until Legacy API Keys are disabled in the Supabase Dashboard.
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

/** Public / browser / user-scoped clients (sb_publishable_* preferred). */
export function getSupabasePublishableKey(): string {
  const key = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.SUPABASE_ANON_KEY
  );
  if (!key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }
  return key;
}

/**
 * Server-only privileged clients (sb_secret_* preferred).
 * Must never be read from NEXT_PUBLIC_* / EXPO_PUBLIC_*.
 */
export function getSupabaseSecretKey(): string {
  const key = firstNonEmpty(
    process.env.SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  if (key.startsWith("sb_publishable_") || key.startsWith("eyJ")) {
    // Allow legacy JWT service_role during migration; reject publishable misuse.
    if (key.startsWith("sb_publishable_")) {
      throw new Error(
        "SUPABASE_SECRET_KEY must be an sb_secret_* (or legacy service_role) key, not publishable"
      );
    }
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
