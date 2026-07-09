// apps/mobile/App.tsx
import React, { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import { ActivityIndicator, Image, Text, View } from "react-native";

// i18n boot (no AppNavigator import — defer Mapbox/native stack)
import "./src/i18n";

import { AppRootShell } from "./src/components/AppRootShell";
import { supabase } from "./src/lib/supabase";
import { getSelectedRole } from "./src/lib/authRole";
import { setupNotifications, registerUserPushToken } from "./src/lib/notifications";
import { mmdAudio } from "./src/lib/mmdAudio";
import { syncLocaleForRole } from "./src/i18n";
import { logStartupProbe, reportBootError } from "./src/lib/startupProbe";
import { initMobileSentry, wrapWithSentry } from "./src/lib/sentry";

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

function App(): React.JSX.Element {
  initMobileSentry();

  const [session, setSession] = useState<SessionLike>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const registerInFlightRef = useRef(false);
  const lastRoleRef = useRef<Role | null>(null);
  const syncingLocaleRef = useRef(false);

  useEffect(() => {
    logStartupProbe("app-mounted");
  }, []);

  useEffect(() => {
    let isMounted = true;

    try {
      setupNotifications();
      void mmdAudio.init();
    } catch (error) {
      reportBootError("setup-notifications", error);
    }

    const syncLocale = async (): Promise<void> => {
      if (!isMounted || syncingLocaleRef.current) return;

      syncingLocaleRef.current = true;

      try {
        const role = toRole((await getSelectedRole()) ?? "client");
        await syncLocaleForRole(role as never);
        lastRoleRef.current = role;
      } catch (error) {
        reportBootError("sync-locale", error);

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
        await registerUserPushToken();
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
        logStartupProbe("auth-ready");

        const userId = currentSession?.user?.id;
        if (userId) void registerToken(userId);
      } catch (error) {
        reportBootError("get-session", error);

        if (!isMounted) return;

        setAuthLoading(false);
        logStartupProbe("auth-ready-with-error");
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
      void mmdAudio.dispose();

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
        require("expo-dev-client").hideMenu();
      } catch {}
    }, 50);
    return () => clearTimeout(timer);
  }, [navPreviewActive]);

  const initialRouteName: "RoleSelect" | "DriverMap" = navPreviewActive
    ? "DriverMap"
    : "RoleSelect";

  const navKey = session?.user?.id ? `authed-${session.user.id}` : "guest";

  if (authLoading) {
    return <Splash />;
  }

  return <AppRootShell initialRouteName={initialRouteName} navKey={navKey} />;
}

export default wrapWithSentry(App);
