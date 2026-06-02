import React from "react";
import { SafeAreaView, Text, View } from "react-native";
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
  return String(getExtra().EXPO_PUBLIC_STRIPE_PK ?? "").trim();
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

function StripeConfigurationError({ message }: { message: string }) {
  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#020617",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <View style={{ maxWidth: 420, gap: 12 }}>
        <Text
          style={{
            color: "#F8FAFC",
            fontSize: 18,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          Paiement indisponible
        </Text>
        <Text style={{ color: "#CBD5E1", textAlign: "center", lineHeight: 22 }}>
          {message}
        </Text>
      </View>
    </SafeAreaView>
  );
}

export default function StripeGate({ initialRouteName }: StripeGateProps) {
  const publishableKey = getPublishableKey();
  const configurationError = getStripeConfigurationError(publishableKey);

  if (configurationError) {
    if (__DEV__) {
      console.log("[StripeGate] configuration error:", configurationError);
    }
    return <StripeConfigurationError message={configurationError} />;
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
    <StripeProvider publishableKey={publishableKey}>
      <AppNavigator initialRouteName={initialRouteName as any} />
    </StripeProvider>
  );
}
