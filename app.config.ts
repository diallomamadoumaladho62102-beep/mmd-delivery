import "dotenv/config";

type AppConfigInput = {
  extra?: Record<string, unknown>;
  [key: string]: unknown;
};

export default ({ config }: { config: AppConfigInput }) => {
  const maybeProcess = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };

  const env = maybeProcess.process?.env ?? {};

  return {
    ...config,
    extra: {
      ...(config.extra ?? {}),

      // 🔥 environnement
      APP_ENV: env.APP_ENV ?? "development",

      // 🔥 API (LOCAL + PROD)
      EXPO_PUBLIC_API_URL_LOCAL: env.EXPO_PUBLIC_API_URL_LOCAL ?? "",
      EXPO_PUBLIC_API_URL_PROD: env.EXPO_PUBLIC_API_URL_PROD ?? "",

      // 🔥 Supabase
      EXPO_PUBLIC_SUPABASE_URL: env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY: env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",

      // 🔥 Mapbox
      EXPO_PUBLIC_MAPBOX_TOKEN: env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "",
    },
  };
};