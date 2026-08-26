import React, { useEffect, useState } from "react";
import Constants from "expo-constants";
import { AppNavigator } from "../navigation/AppNavigator";
import { supabase } from "./supabase";

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

type StripeProviderComponent = React.ComponentType<{
  publishableKey: string;
  merchantIdentifier?: string;
  children?: React.ReactNode;
}>;

/**
 * Loads Stripe native views only after a session exists.
 * A static import of @stripe/stripe-react-native registers Fabric
 * ViewManagers on Login and surfaces "Unimplemented component: ViewManagerAdapter".
 */
function LazyStripeTree({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: React.ReactNode;
}) {
  const [Provider, setProvider] = useState<StripeProviderComponent | null>(null);

  useEffect(() => {
    let alive = true;
    void import("@stripe/stripe-react-native")
      .then((mod) => {
        if (alive && mod.StripeProvider) {
          setProvider(() => mod.StripeProvider as StripeProviderComponent);
        }
      })
      .catch((e) => {
        if (__DEV__) {
          console.log("[StripeGate] Stripe native module unavailable:", e);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!Provider) {
    return <>{children}</>;
  }

  return (
    <Provider
      publishableKey={publishableKey}
      merchantIdentifier="merchant.com.maladho2025.mmddelivery"
    >
      {children}
    </Provider>
  );
}

export default function StripeGate({ initialRouteName }: StripeGateProps) {
  // Hooks always run — never after the config early-outs below.
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (alive) setHasSession(Boolean(data.session));
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(Boolean(session));
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const publishableKey = getPublishableKey();
  const configurationError = getStripeConfigurationError(publishableKey);
  const navigator = (
    <AppNavigator initialRouteName={initialRouteName as never} />
  );

  // Never mount Stripe native views on RoleSelect / Login.
  if (configurationError) {
    if (__DEV__) {
      console.log("[StripeGate] configuration error (non-blocking):", configurationError);
    }
    return navigator;
  }

  if (!publishableKey) {
    if (__DEV__) {
      console.log(
        "[StripeGate] Missing EXPO_PUBLIC_STRIPE_PK — StripeProvider disabled in development."
      );
    }
    return navigator;
  }

  if (!hasSession) {
    return navigator;
  }

  return (
    <LazyStripeTree publishableKey={publishableKey}>{navigator}</LazyStripeTree>
  );
}
