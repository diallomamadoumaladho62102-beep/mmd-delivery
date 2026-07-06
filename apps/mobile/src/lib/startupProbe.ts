import Constants from "expo-constants";

const BOOT_TAG = "[MMD-BOOT]";

type Extra = Record<string, unknown>;

function readExtra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

function hasValue(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

/** Production-safe startup diagnostics for Xcode device console. */
export function logStartupProbe(phase: string): void {
  const extra = readExtra();
  const probe = {
    phase,
    appEnv: extra.APP_ENV ?? null,
    easProfile: extra.EAS_BUILD_PROFILE ?? null,
    apiProd: hasValue(extra.EXPO_PUBLIC_API_URL_PROD),
    supabaseUrl:
      hasValue(process.env.EXPO_PUBLIC_SUPABASE_URL) ||
      hasValue(extra.EXPO_PUBLIC_SUPABASE_URL),
    supabaseKey:
      hasValue(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) ||
      hasValue(extra.EXPO_PUBLIC_SUPABASE_ANON_KEY),
    mapboxToken:
      hasValue(process.env.EXPO_PUBLIC_MAPBOX_TOKEN) ||
      hasValue(extra.EXPO_PUBLIC_MAPBOX_TOKEN),
    stripePk:
      hasValue(process.env.EXPO_PUBLIC_STRIPE_PK) ||
      hasValue(extra.EXPO_PUBLIC_STRIPE_PK),
    executionEnvironment: Constants.executionEnvironment ?? null,
  };

  console.log(BOOT_TAG, JSON.stringify(probe));
}

export function formatBootError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function reportBootError(scope: string, error: unknown): void {
  console.error(BOOT_TAG, scope, formatBootError(error));
}
