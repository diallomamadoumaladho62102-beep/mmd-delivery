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
const STRIPE_MERCHANT_ID = "merchant.com.maladho2025.mmddelivery";

function cleanEnv(value: string | undefined): string {
  return (value ?? "").trim();
}

function assertStripePublishableKeyForEasBuild(params: {
  easBuildProfile: string;
  stripePublishableKey: string;
}) {
  const { easBuildProfile, stripePublishableKey } = params;

  if (easBuildProfile !== "production") {
    if (
      stripePublishableKey &&
      !stripePublishableKey.startsWith("pk_test_") &&
      !stripePublishableKey.startsWith("pk_live_")
    ) {
      throw new Error(
        "[MMD] EXPO_PUBLIC_STRIPE_PK must start with pk_test_ or pk_live_."
      );
    }
    return;
  }

  if (!stripePublishableKey) {
    throw new Error(
      "[MMD] Production EAS build requires EXPO_PUBLIC_STRIPE_PK. Set an EAS secret with your pk_live_ key."
    );
  }

  if (stripePublishableKey.startsWith("pk_test_")) {
    throw new Error(
      "[MMD] Production EAS build cannot use a pk_test_ Stripe publishable key."
    );
  }

  if (!stripePublishableKey.startsWith("pk_live_")) {
    throw new Error(
      "[MMD] Production EAS build requires a pk_live_ Stripe publishable key."
    );
  }
}

export default ({ config }: { config: AppConfigInput }) => {
  const env =
    (globalThis as typeof globalThis & {
      process?: { env?: Record<string, string | undefined> };
    }).process?.env ?? {};

  const APP_ENV: AppEnv =
    env.APP_ENV === "production" ? "production" : "development";

  const EXPO_PUBLIC_API_URL_LOCAL = cleanEnv(env.EXPO_PUBLIC_API_URL_LOCAL);
  const EXPO_PUBLIC_API_URL_PROD = cleanEnv(env.EXPO_PUBLIC_API_URL_PROD);
  const EXPO_PUBLIC_SUPABASE_URL = cleanEnv(env.EXPO_PUBLIC_SUPABASE_URL);
  const EXPO_PUBLIC_SUPABASE_ANON_KEY = cleanEnv(
    env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  );
  const EXPO_PUBLIC_MAPBOX_TOKEN = cleanEnv(env.EXPO_PUBLIC_MAPBOX_TOKEN);
  const EXPO_PUBLIC_STRIPE_PK = cleanEnv(env.EXPO_PUBLIC_STRIPE_PK);
  const RNMAPBOX_MAPS_DOWNLOAD_TOKEN = cleanEnv(
    env.RNMAPBOX_MAPS_DOWNLOAD_TOKEN
  );
  const EAS_BUILD_PROFILE = cleanEnv(env.EAS_BUILD_PROFILE);

  assertStripePublishableKeyForEasBuild({
    easBuildProfile: EAS_BUILD_PROFILE,
    stripePublishableKey: EXPO_PUBLIC_STRIPE_PK,
  });

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
    icon: "./apps/mobile/assets/icon.png",
    userInterfaceStyle: "automatic",
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
          merchantIdentifier: STRIPE_MERCHANT_ID,
        },
      ],
      [
        "@rnmapbox/maps",
        {
          RNMapboxMapsDownloadToken: RNMAPBOX_MAPS_DOWNLOAD_TOKEN,
        },
      ],
      "expo-image-picker",
      "expo-location",
      "expo-task-manager",
      "expo-web-browser",
    ],

    updates: {
      url: `https://u.expo.dev/${PROJECT_ID}`,
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: {
      policy: "appVersion",
    },

    splash: {
      image: "./apps/mobile/assets/brand/mmd-logo.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },

    ios: {
      ...existingIos,
      bundleIdentifier: IOS_BUNDLE_ID,
      buildNumber: "1.0.0",
      supportsTablet: true,
      associatedDomains: [
        "applinks:www.mmddelivery.com",
        "applinks:mmddelivery.com",
      ],
      infoPlist: {
        ...existingInfoPlist,
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          "MMD Delivery utilise la caméra pour les preuves de pickup et de livraison.",
        NSPhotoLibraryUsageDescription:
          "MMD Delivery accède à vos photos pour joindre des preuves ou images au chat.",
        NSPhotoLibraryAddUsageDescription:
          "MMD Delivery peut enregistrer des photos de preuve dans votre galerie.",
        NSLocationWhenInUseUsageDescription:
          "MMD Delivery utilise votre position pour localiser le chauffeur et afficher les livraisons proches.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "MMD Delivery utilise votre position pour les livraisons en temps réel.",
        NSLocationAlwaysUsageDescription:
          "MMD Delivery utilise votre position pour suivre les livraisons en temps réel lorsque vous êtes en ligne.",
        UIBackgroundModes: ["location"],
      },
    },

    android: {
      ...existingAndroid,
      package: ANDROID_PACKAGE,
      versionCode: 1,
      permissions: [
        "INTERNET",
        "POST_NOTIFICATIONS",
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
        "CAMERA",
        "READ_MEDIA_IMAGES",
        "READ_EXTERNAL_STORAGE",
      ],
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            {
              scheme: "https",
              host: "www.mmddelivery.com",
              pathPrefix: "/",
            },
            {
              scheme: "https",
              host: "mmddelivery.com",
              pathPrefix: "/",
            },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
      adaptiveIcon: {
        foregroundImage: "./apps/mobile/assets/icon.png",
        backgroundColor: "#FF8C00",
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
      EAS_BUILD_PROFILE: EAS_BUILD_PROFILE || "",
      eas: {
        projectId: PROJECT_ID,
      },
    },
  };
};