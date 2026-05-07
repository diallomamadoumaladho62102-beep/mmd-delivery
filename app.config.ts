import "dotenv/config";

type AppConfigInput = {
  extra?: Record<string, unknown>;
  ios?: Record<string, unknown>;
  android?: Record<string, unknown>;
  plugins?: unknown[];
  [key: string]: unknown;
};

type AppEnv = "development" | "production";

const PROJECT_ID = "127751ea-33ce-4f67-98ce-a9b29a46b838";
const ANDROID_PACKAGE = "com.maladho2025.mmddelivery";
const IOS_BUNDLE_ID = "com.maladho2025.mmddelivery";

function cleanEnv(value: string | undefined): string {
  return (value ?? "").trim();
}

export default ({ config }: { config: AppConfigInput }) => {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: {
      env?: Record<string, string | undefined>;
    };
  };

  const env = maybeProcess.process?.env ?? {};

  const APP_ENV: AppEnv =
    env.APP_ENV === "production" ? "production" : "development";

  const EXPO_PUBLIC_API_URL_LOCAL = cleanEnv(
    env.EXPO_PUBLIC_API_URL_LOCAL
  );

  const EXPO_PUBLIC_API_URL_PROD = cleanEnv(
    env.EXPO_PUBLIC_API_URL_PROD
  );

  const EXPO_PUBLIC_SUPABASE_URL = cleanEnv(
    env.EXPO_PUBLIC_SUPABASE_URL
  );

  const EXPO_PUBLIC_SUPABASE_ANON_KEY = cleanEnv(
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  );

  const EXPO_PUBLIC_MAPBOX_TOKEN = cleanEnv(
    env.EXPO_PUBLIC_MAPBOX_TOKEN
  );

  const EXPO_PUBLIC_STRIPE_PK = cleanEnv(
    env.EXPO_PUBLIC_STRIPE_PK
  );

  const API_URL =
    APP_ENV === "production"
      ? EXPO_PUBLIC_API_URL_PROD
      : EXPO_PUBLIC_API_URL_LOCAL;

  const existingIos = config.ios ?? {};
  const existingAndroid = config.android ?? {};
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

    plugins: [
      [
        "expo-notifications",
        {
          sounds: ["./apps/mobile/assets/sounds/new_order.wav"],
        },
      ],

      [
        "@stripe/stripe-react-native",
        {
          merchantIdentifier: "merchant.com.mmd.delivery",
        },
      ],

      "expo-web-browser",
    ],

    splash: {
      image: "./assets/brand/mmd-logo.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },

    ios: {
      ...existingIos,

      bundleIdentifier: IOS_BUNDLE_ID,

      buildNumber: "1.0.0",

      supportsTablet: true,

      infoPlist: {
        ...existingInfoPlist,

        ITSAppUsesNonExemptEncryption: false,
      },
    },

    android: {
      ...existingAndroid,

      package: ANDROID_PACKAGE,

      versionCode: 1,

      permissions: ["INTERNET", "POST_NOTIFICATIONS"],

      adaptiveIcon: {
        foregroundImage: "./assets/icon.png",

        backgroundColor: "#ffffff",
      },
    },

    extra: {
      ...existingExtra,

      APP_ENV,

      EXPO_PUBLIC_API_URL: API_URL || "",

      EXPO_PUBLIC_API_URL_LOCAL,

      EXPO_PUBLIC_API_URL_PROD,

      EXPO_PUBLIC_SUPABASE_URL,

      EXPO_PUBLIC_SUPABASE_ANON_KEY,

      EXPO_PUBLIC_MAPBOX_TOKEN,

      EXPO_PUBLIC_STRIPE_PK,

      eas: {
        projectId: PROJECT_ID,
      },
    },
  };
};