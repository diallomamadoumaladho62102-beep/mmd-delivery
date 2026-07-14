/**
 * Resolve Supabase keys inside Edge Functions.
 *
 * Prefer explicit singular names if present (usually blocked as reserved),
 * then platform-injected SUPABASE_*_KEYS JSON objects (keyed by name, e.g. "default"),
 * then legacy JWT env names (temporary until Legacy API Keys are disabled).
 *
 * Docs:
 * https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
 *   JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')!)['default']
 */

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    const trimmed = typeof value === "string" ? value.trim() : "";
    if (trimmed) return trimmed;
  }
  return "";
}

/**
 * Parse platform key bags:
 * - JSON object: { "default": "sb_secret_..." }
 * - JSON array of strings / objects
 * - plain single key string
 * - comma-separated list (legacy guess)
 */
function pickFromKeysEnv(raw: string | undefined | null): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return "";

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "string" && item.trim()) return item.trim();
          if (item && typeof item === "object") {
            const rec = item as Record<string, unknown>;
            for (const k of ["api_key", "key", "value", "default"]) {
              if (typeof rec[k] === "string" && String(rec[k]).trim()) {
                return String(rec[k]).trim();
              }
            }
          }
        }
      } else if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (typeof obj.default === "string" && obj.default.trim()) {
          return obj.default.trim();
        }
        for (const value of Object.values(obj)) {
          if (typeof value === "string" && value.trim()) return value.trim();
          if (value && typeof value === "object") {
            const rec = value as Record<string, unknown>;
            for (const k of ["api_key", "key", "value"]) {
              if (typeof rec[k] === "string" && String(rec[k]).trim()) {
                return String(rec[k]).trim();
              }
            }
          }
        }
      }
    } catch {
      // fall through
    }
  }

  if (trimmed.startsWith("sb_") || trimmed.startsWith("eyJ")) {
    return trimmed;
  }

  return trimmed.split(",")[0]?.trim() ?? "";
}

export function getEdgeSupabaseUrl(): string {
  const url = firstNonEmpty(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("NEXT_PUBLIC_SUPABASE_URL")
  );
  if (!url) {
    throw new Error("Missing SUPABASE_URL");
  }
  return url;
}

/** Low-privilege key for user-scoped clients (publishable preferred). */
export function getEdgePublishableKey(): string {
  const key = firstNonEmpty(
    Deno.env.get("SUPABASE_PUBLISHABLE_KEY"),
    pickFromKeysEnv(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")),
    Deno.env.get("SUPABASE_ANON_KEY")
  );
  if (!key) {
    throw new Error(
      "Missing SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEYS / SUPABASE_ANON_KEY"
    );
  }
  return key;
}

/** Privileged key for admin clients (secret preferred). */
export function getEdgeSecretKey(): string {
  const key = firstNonEmpty(
    Deno.env.get("SUPABASE_SECRET_KEY"),
    pickFromKeysEnv(Deno.env.get("SUPABASE_SECRET_KEYS")),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SECRET_KEY / SUPABASE_SECRET_KEYS / SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return key;
}

export function getEdgePublishableKeyOptional(): string {
  try {
    return getEdgePublishableKey();
  } catch {
    return "";
  }
}

export function getEdgeSecretKeyOptional(): string {
  try {
    return getEdgeSecretKey();
  } catch {
    return "";
  }
}
