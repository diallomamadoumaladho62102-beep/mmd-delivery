import "dotenv/config";

type AppConfigInput = {
  extra?: Record<string, unknown>;
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
  [key: string]: unknown;
};

export default ({ config }: { config: AppConfigInput }) => {
  const maybeProcess = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };

  const env = maybeProcess.process?.env ?? {};

  // ✅ Environnement
  const APP_ENV = env.APP_ENV ?? "development";

  // ✅ Choix automatique API
  const EXPO_PUBLIC_API_URL =
    APP_ENV === "production"
      ? env.EXPO_PUBLIC_API_URL_PROD
      : env.EXPO_PUBLIC_API_URL_LOCAL;

  return {
    ...config,

    ios: {
      ...(config.ios ?? {}),
      bundleIdentifier: "com.maladho2025.mmddelivery",
    },

    android: {
      ...(config.android ?? {}),
      package: "com.maladho2025.mmddelivery",
    },

    extra: {
      ...(config.extra ?? {}),

      // 🔥 ENV
      APP_ENV,

      // 🔥 API toujours définie
      EXPO_PUBLIC_API_URL:
        EXPO_PUBLIC_API_URL ??
        env.EXPO_PUBLIC_SUPABASE_URL ??
        "",

      // 🔥 Supabase
      EXPO_PUBLIC_SUPABASE_URL:
        env.EXPO_PUBLIC_SUPABASE_URL ?? "",
      EXPO_PUBLIC_SUPABASE_ANON_KEY:
        env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",

      // 🔥 Mapbox
      EXPO_PUBLIC_MAPBOX_TOKEN:
        env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "",

      // 🔥 EAS (sécurité)
      eas: {
        projectId: "127751ea-33ce-4f67-98ce-a9b29a46b838",
      },
    },
  };
};