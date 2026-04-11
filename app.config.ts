import "dotenv/config";

type AppConfigInput = {
  extra?: Record<string, unknown>;
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
  [key: string]: unknown;
};

type AppEnv = "development" | "production";

function cleanEnv(value: string | undefined): string {
  return (value ?? "").trim();
}

export default ({ config }: { config: AppConfigInput }) => {
  const maybeProcess = globalThis as {
    process?: { env?: Record<string, string | undefined> };
  };

  const env = maybeProcess.process?.env ?? {};

  const APP_ENV: AppEnv =
    env.APP_ENV === "production" ? "production" : "development";

  const EXPO_PUBLIC_API_URL_LOCAL = cleanEnv(env.EXPO_PUBLIC_API_URL_LOCAL);
  const EXPO_PUBLIC_API_URL_PROD = cleanEnv(env.EXPO_PUBLIC_API_URL_PROD);
  const EXPO_PUBLIC_SUPABASE_URL = cleanEnv(env.EXPO_PUBLIC_SUPABASE_URL);
  const EXPO_PUBLIC_SUPABASE_ANON_KEY = cleanEnv(env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const EXPO_PUBLIC_MAPBOX_TOKEN = cleanEnv(env.EXPO_PUBLIC_MAPBOX_TOKEN);

  const API_URL =
    APP_ENV === "production"
      ? EXPO_PUBLIC_API_URL_PROD
      : EXPO_PUBLIC_API_URL_LOCAL;

  const existingIos =
    (config.ios as Record<string, unknown> | undefined) ?? {};
  const existingAndroid =
    (config.android as Record<string, unknown> | undefined) ?? {};
  const existingExtra = config.extra ?? {};
  const existingInfoPlist =
    (existingIos.infoPlist as Record<string, unknown> | undefined) ?? {};

  return {
    ...config,

    name: "MMD Delivery",
    slug: "mmd-delivery",
    description: "MMD Delivery - Food and delivery platform",
    version: "1.0.0",
    orientation: "portrait",
    scheme: "mmddelivery",
    icon: "./assets/icon.png",
    assetBundlePatterns: ["**/*"],

    splash: {
      image: "./assets/brand/mmd-logo.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },

    ios: {
      ...existingIos,
      bundleIdentifier: "com.maladho2025.mmddelivery",
      buildNumber: "1.0.0",
      supportsTablet: true,
      infoPlist: {
        ...existingInfoPlist,
        ITSAppUsesNonExemptEncryption: false,
      },
    },

    android: {
      ...existingAndroid,
      package: "com.maladho2025.mmddelivery",
      versionCode: 1,
      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",
        backgroundColor: "#ffffff",
      },
    },

    extra: {
      ...existingExtra,
      APP_ENV,

      // IMPORTANT:
      // L'app mobile doit appeler ton backend web pour /api/stripe/...
      // donc on n'utilise PAS Supabase comme fallback ici.
      EXPO_PUBLIC_API_URL: API_URL || "",

      EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY,
      EXPO_PUBLIC_MAPBOX_TOKEN,

      eas: {
        projectId: "127751ea-33ce-4f67-98ce-a9b29a46b838",
      },
    },
  };
};