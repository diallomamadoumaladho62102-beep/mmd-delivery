import "dotenv/config";

type AppConfigInput = {
  extra?: Record<string, unknown>;
  ios?: Record<string, unknown>;
  [key: string]: unknown;
};

export default ({ config }: { config: AppConfigInput }) => {
  const maybeProcess = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };

  const env = maybeProcess.process?.env ?? {};

  return {
    ...config,

    ios: {
      ...(config.ios ?? {}),
      bundleIdentifier: "com.maladho2025.mmddelivery",
    },

    extra: {
      ...(config.extra ?? {}),

      APP_ENV: env.APP_ENV ?? "development",
      EXPO_PUBLIC_API_URL: env.EXPO_PUBLIC_API_URL ?? "",

      EXPO_PUBLIC_SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
      EXPO_PUBLIC_MAPBOX_TOKEN: env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "",
    },
  };
};