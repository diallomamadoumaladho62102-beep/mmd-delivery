import React from "react";
import Constants from "expo-constants";
import { StripeProvider } from "@stripe/stripe-react-native";
import { AppNavigator } from "../navigation/AppNavigator";

type StripeGateProps = {
  initialRouteName?: string;
};

type ExpoExtra = {
  APP_ENV?: string;
  EAS_BUILD_PROFILE?: string;
  EXPO_PUBLIC_STRIPE_PK?: string;
};

function getExtra(): ExpoExtra {
  return (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
}

function getPublishableKey(): string {
  return (
    String(process.env.EXPO_PUBLIC_STRIPE_PK ?? "").trim() ||
    String(getExtra().EXPO_PUBLIC_STRIPE_PK ?? "").trim()
  );
}

function isStrictProductionRuntime(): boolean {
  const extra = getExtra();
  const appEnv = String(extra.APP_ENV ?? "development").toLowerCase();
  const buildProfile = String(extra.EAS_BUILD_PROFILE ?? "").toLowerCase();

  return appEnv === "production" && buildProfile === "production";
}

function getStripeConfigurationError(publishableKey: string): string | null {
  if (!publishableKey) {
    return isStrictProductionRuntime()
      ? "Configuration Stripe manquante. Le build production requiert EXPO_PUBLIC_STRIPE_PK (pk_live_...) via EAS."
      : null;
  }

  if (publishableKey.startsWith("pk_test_") && isStrictProductionRuntime()) {
    return "Clé Stripe de test détectée en build production. Utilisez pk_live_ via les secrets EAS.";
  }

  if (
    publishableKey &&
    !publishableKey.startsWith("pk_test_") &&
    !publishableKey.startsWith("pk_live_")
  ) {
    return "Clé Stripe invalide. La clé publishable doit commencer par pk_test_ ou pk_live_.";
  }

  return null;
}

export default function StripeGate({ initialRouteName }: StripeGateProps) {
  const publishableKey = getPublishableKey();
  const configurationError = getStripeConfigurationError(publishableKey);

  // Never block RoleSelect / Login for Stripe config issues (Apple 2.1 App Completeness).
  // Payments still fail clearly at checkout; auth entry must always render.
  if (configurationError) {
    if (__DEV__) {
      console.log("[StripeGate] configuration error (non-blocking):", configurationError);
    }
    return <AppNavigator initialRouteName={initialRouteName as any} />;
  }

  if (!publishableKey) {
    if (__DEV__) {
      console.log(
        "[StripeGate] Missing EXPO_PUBLIC_STRIPE_PK — StripeProvider disabled in development."
      );
    }
    return <AppNavigator initialRouteName={initialRouteName as any} />;
  }

  return (
    <StripeProvider
      publishableKey={publishableKey}
      merchantIdentifier="merchant.com.maladho2025.mmddelivery"
    >
      <AppNavigator initialRouteName={initialRouteName as any} />
    </StripeProvider>
  );
}
