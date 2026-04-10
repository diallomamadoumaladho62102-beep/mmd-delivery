// apps/mobile/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Device from "expo-device";
import { View, Text } from "react-native";

// i18n boot (side effect global)
// Important: garder cet import pour initialiser i18n au démarrage.
import "./src/i18n";

import { AppNavigator } from "./src/navigation/AppNavigator";
import { supabase } from "./src/lib/supabase";
import { getSelectedRole } from "./src/lib/authRole";
import { API_BASE_URL } from "./lib/apiBase";
import { setupNotifications, getExpoPushToken } from "./src/lib/notifications";
import { syncLocaleForRole } from "./src/i18n";

type Role = "client" | "driver" | "restaurant";

type SavedTokenState = {
  userId: string;
  token: string;
  role: string;
  deviceId: string;
};

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
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Chargement…</Text>
    </View>
  );
}

function FatalFallback({ message }: { message: string }): React.JSX.Element {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      <Text style={{ textAlign: "center" }}>{message}</Text>
    </View>
  );
}

async function getDeviceIdSafe(): Promise<string> {
  try {
    const androidIdFn = (Application as { getAndroidId?: () => string | null }).getAndroidId;
    if (typeof androidIdFn === "function") {
      const androidId = androidIdFn();
      if (androidId) {
        return String(androidId);
      }
    }

    const iosIdFn = (
      Application as { getIosIdForVendorAsync?: () => Promise<string | null> }
    ).getIosIdForVendorAsync;
    if (typeof iosIdFn === "function") {
      const iosId = await iosIdFn();
      if (iosId) {
        return String(iosId);
      }
    }
  } catch {
    // fallback below
  }

  return `${Device.modelName ?? "device"}-${Device.osName ?? "os"}-${Device.osVersion ?? "0"}`;
}

function getStripeGateSafe(): React.ComponentType<{ initialRouteName: string }> | null {
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
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const lastSavedRef = useRef<SavedTokenState | null>(null);
  const registerInFlightRef = useRef(false);
  const lastRoleRef = useRef<Role | null>(null);
  const syncingLocaleRef = useRef(false);

  if (__DEV__) {
    console.log("MMD MOBILE API_BASE_URL =", API_BASE_URL);
    console.log("SUPABASE_URL =", process.env.EXPO_PUBLIC_SUPABASE_URL);
    console.log("SUPABASE_KEY_OK =", !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  }

  useEffect(() => {
    let isMounted = true;

    try {
      setupNotifications();
    } catch (error) {
      if (__DEV__) {
        console.log("[App] setupNotifications error:", error);
      }
    }

    const syncLocale = async (): Promise<void> => {
      if (!isMounted || syncingLocaleRef.current) {
        return;
      }

      syncingLocaleRef.current = true;

      try {
        const role = toRole((await getSelectedRole()) ?? "client");
        await syncLocaleForRole(role as any);
        lastRoleRef.current = role;
      } catch (error) {
        if (__DEV__) {
          console.log("[App] syncLocale error:", error);
        }

        try {
          await syncLocaleForRole("client" as any);
          lastRoleRef.current = "client";
        } catch {
          // ignore fallback failure
        }
      } finally {
        syncingLocaleRef.current = false;
      }
    };

    const registerToken = async (userId: string): Promise<void> => {
      try {
        if (!isMounted || registerInFlightRef.current) {
          return;
        }

        registerInFlightRef.current = true;

        if (__DEV__) {
          console.log("👤 USER ID (session):", userId);
        }

        const expoToken = await getExpoPushToken();

        if (__DEV__) {
          console.log("📲 EXPO PUSH TOKEN:", expoToken);
        }

        if (!expoToken) {
          if (__DEV__) {
            console.log("❌ Pas de token (permissions refusées / simulateur / limitation)");
          }
          return;
        }

        const deviceId = await getDeviceIdSafe();
        const role = toRole((await getSelectedRole()) ?? "client");
        const platform = `${Device.osName ?? ""} ${Device.osVersion ?? ""}`.trim();
        const appVersion = Application.nativeApplicationVersion ?? "unknown";

        if (
          lastSavedRef.current?.userId === userId &&
          lastSavedRef.current?.token === expoToken &&
          lastSavedRef.current?.role === role &&
          lastSavedRef.current?.deviceId === deviceId
        ) {
          if (__DEV__) {
            console.log("↩️ Token déjà enregistré (même device/role), skip");
          }
          return;
        }

        const { error } = await supabase.from("user_push_tokens").upsert({
          user_id: userId,
          device_id: deviceId,
          role,
          expo_push_token: expoToken,
          platform,
          app_version: appVersion,
          updated_at: new Date().toISOString(),
        });

        if (error) {
          if (__DEV__) {
            console.log("❌ Save token error:", error);
          }
          return;
        }

        lastSavedRef.current = {
          userId,
          token: expoToken,
          role,
          deviceId,
        };

        if (__DEV__) {
          console.log("✅ Token enregistré dans user_push_tokens (multi-device)");
        }
      } finally {
        registerInFlightRef.current = false;
      }
    };

    void (async () => {
      await syncLocale();

      try {
        const { data } = await supabase.auth.getSession();

        if (!isMounted) {
          return;
        }

        const currentSession = data.session ?? null;
        setSession(currentSession);
        setAuthLoading(false);

        if (currentSession?.user?.id) {
          void registerToken(currentSession.user.id);
        }
      } catch (error) {
        if (__DEV__) {
          console.log("[App] getSession error:", error);
        }

        if (!isMounted) {
          return;
        }

        setAuthLoading(false);
      }
    })();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!isMounted) {
        return;
      }

      const currentSession = newSession ?? null;
      setSession(currentSession);
      setAuthLoading(false);

      void syncLocale();

      if (currentSession?.user?.id) {
        void registerToken(currentSession.user.id);
      }
    });

    const rolePoll = setInterval(() => {
      void (async () => {
        try {
          const role = toRole((await getSelectedRole()) ?? "client");
          if (lastRoleRef.current !== role) {
            await syncLocale();
          }
        } catch {
          // ignore polling errors
        }
      })();
    }, 1500);

    return () => {
      isMounted = false;
      clearInterval(rolePoll);

      try {
        authListener?.subscription?.unsubscribe?.();
      } catch {
        // ignore unsubscribe errors
      }
    };
  }, []);

  const initialRouteName = useMemo(() => {
    return session ? "ClientHome" : "RoleSelect";
  }, [session]);

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