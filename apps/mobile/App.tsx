// apps/mobile/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Constants from "expo-constants";
import { ActivityIndicator, Image, Text, View } from "react-native";
import * as DevClient from "expo-dev-client";

// i18n boot
import "./src/i18n";

import { AppNavigator } from "./src/navigation/AppNavigator";
import { supabase } from "./src/lib/supabase";
import { getSelectedRole } from "./src/lib/authRole";
import { API_BASE_URL } from "./lib/apiBase";
import { setupNotifications, registerUserPushToken } from "./src/lib/notifications";
import { syncLocaleForRole } from "./src/i18n";

type Role = "client" | "driver" | "restaurant";

type SessionLike = {
  user?: {
    id?: string;
  } | null;
} | null;

function toRole(value: unknown): Role {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "driver" || normalized === "restaurant") {
    return normalized;
  }
  return "client";
}

function isExpoGo(): boolean {
  const ownership = (Constants as { appOwnership?: string } | undefined)?.appOwnership;
  return ownership === "expo";
}

function Splash(): React.JSX.Element {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#111827",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Image
        source={require("./assets/brand/mmd-logo.png")}
        style={{
          width: 140,
          height: 140,
          marginBottom: 24,
        }}
        resizeMode="contain"
      />

      <ActivityIndicator size="large" color="#FFFFFF" />

      <Text
        style={{
          marginTop: 20,
          color: "#FFFFFF",
          fontSize: 16,
          fontWeight: "700",
          letterSpacing: 0.3,
          textAlign: "center",
        }}
      >
        MMD Delivery
      </Text>
    </View>
  );
}

function FatalFallback({ message }: { message: string }): React.JSX.Element {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Text style={{ textAlign: "center" }}>{message}</Text>
    </View>
  );
}

function getStripeGateSafe(): React.ComponentType<{
  initialRouteName: string;
}> | null {
  try {
    const stripeGateModule = require("./src/lib/StripeGate");
    const StripeGate = stripeGateModule?.default ?? stripeGateModule;

    if (!StripeGate) {
      if (__DEV__) {
        console.log("[App] StripeGate module loaded but export is empty");
      }
      return null;
    }

    return StripeGate;
  } catch (error) {
    if (__DEV__) {
      console.log("[App] StripeGate load error:", error);
    }
    return null;
  }
}

export default function App(): React.JSX.Element {
  const [session, setSession] = useState<SessionLike>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const registerInFlightRef = useRef(false);
  const lastRoleRef = useRef<Role | null>(null);
  const syncingLocaleRef = useRef(false);

  if (__DEV__) {
    console.log("MMD MOBILE API_BASE_URL =", API_BASE_URL);
    console.log("SUPABASE_URL =", process.env.EXPO_PUBLIC_SUPABASE_URL);
    console.log("SUPABASE_KEY_OK =", !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
    console.log(
      "MAPBOX_TOKEN_OK =",
      !!String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "").trim()
    );
  }

  useEffect(() => {
    let isMounted = true;

    try {
      setupNotifications();
    } catch (error) {
      if (__DEV__) console.log("[App] setupNotifications error:", error);
    }

    const syncLocale = async (): Promise<void> => {
      if (!isMounted || syncingLocaleRef.current) return;

      syncingLocaleRef.current = true;

      try {
        const role = toRole((await getSelectedRole()) ?? "client");
        await syncLocaleForRole(role as never);
        lastRoleRef.current = role;
      } catch (error) {
        if (__DEV__) console.log("[App] syncLocale error:", error);

        try {
          await syncLocaleForRole("client" as never);
          lastRoleRef.current = "client";
        } catch {}
      } finally {
        syncingLocaleRef.current = false;
      }
    };

    const registerToken = async (userId: string): Promise<void> => {
      try {
        if (!isMounted || registerInFlightRef.current) return;

        registerInFlightRef.current = true;

        if (__DEV__) console.log("👤 USER ID (session):", userId);

        const expoToken = await registerUserPushToken();

        if (__DEV__) {
          console.log(
            expoToken
              ? "✅ Token enregistré dans user_push_tokens"
              : "❌ Pas de token push disponible ou rôle non supporté",
          );
        }
      } finally {
        registerInFlightRef.current = false;
      }
    };

    void (async () => {
      await syncLocale();

      try {
        const { data } = await supabase.auth.getSession();

        if (!isMounted) return;

        const currentSession = (data.session ?? null) as SessionLike;
        setSession(currentSession);
        setAuthLoading(false);

        const userId = currentSession?.user?.id;
        if (userId) void registerToken(userId);
      } catch (error) {
        if (__DEV__) console.log("[App] getSession error:", error);

        if (!isMounted) return;

        setAuthLoading(false);
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!isMounted) return;

        const currentSession = (newSession ?? null) as SessionLike;
        setSession(currentSession);
        setAuthLoading(false);

        void syncLocale();

        const userId = currentSession?.user?.id;
        if (userId) void registerToken(userId);
      }
    );

    const rolePoll = setInterval(() => {
      void (async () => {
        try {
          const role = toRole((await getSelectedRole()) ?? "client");
          if (lastRoleRef.current !== role) {
            await syncLocale();
          }
        } catch {}
      })();
    }, 5000);

    return () => {
      isMounted = false;
      clearInterval(rolePoll);

      try {
        authListener?.subscription?.unsubscribe?.();
      } catch {}
    };
  }, []);

  const navPreviewActive =
    __DEV__ && process.env.EXPO_PUBLIC_DRIVER_NAV_PREVIEW === "1";

  useEffect(() => {
    if (!navPreviewActive) return;
    const timer = setTimeout(() => {
      try {
        DevClient.hideMenu();
      } catch {
        // ignore dev-client menu errors
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [navPreviewActive]);

  // Important production fix:
  // Do not open ClientHome by default for every authenticated user.
  // AppNavigator resolves the real role and redirects properly.
  const initialRouteName: "RoleSelect" | "DriverMap" = navPreviewActive
    ? "DriverMap"
    : "RoleSelect";

  const navKey = session?.user?.id ? `authed-${session.user.id}` : "guest";
  const StripeGate = useMemo(() => getStripeGateSafe(), []);

  if (authLoading) {
    return <Splash />;
  }

  if (isExpoGo()) {
    return (
      <View style={{ flex: 1 }}>
        <AppNavigator key={navKey} initialRouteName={initialRouteName} />
      </View>
    );
  }

  if (!StripeGate) {
    return (
      <FatalFallback message="Module Stripe indisponible. Vérifie StripeGate et relance l’application." />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <StripeGate key={navKey} initialRouteName={initialRouteName} />
    </View>
  );
}