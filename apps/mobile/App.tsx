// apps/mobile/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Device from "expo-device";
import { View, Text } from "react-native";

// ✅ i18n (side-effect global boot)
// IMPORTANT: laisse cet import, même si tu importes aussi syncLocaleForRole.
import "./src/i18n";

import { AppNavigator } from "./src/navigation/AppNavigator";
import { supabase } from "./src/lib/supabase";
import { getSelectedRole } from "./src/lib/authRole";

// ✅ Notifications (exports corrigés)
import { setupNotifications, getExpoPushToken } from "./src/lib/notifications";

// ✅ i18n (API)
import { syncLocaleForRole } from "./src/i18n/index";

console.log("API_URL =", process.env.EXPO_PUBLIC_API_URL);
console.log("SUPABASE_URL =", process.env.EXPO_PUBLIC_SUPABASE_URL);
console.log("SUPABASE_KEY_OK =", !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

type Role = "client" | "driver" | "restaurant";

function toRole(v: any): Role {
  const x = String(v ?? "").toLowerCase();
  if (x === "driver" || x === "restaurant") return x;
  return "client";
}

function isExpoGo(): boolean {
  const ownership = (Constants as any)?.appOwnership;
  return ownership === "expo";
}

function Splash() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <Text>Chargement…</Text>
    </View>
  );
}

async function getDeviceIdSafe(): Promise<string> {
  try {
    // ✅ Android: méthode officielle (SDK récent)
    const androidIdFn = (Application as any).getAndroidId;
    if (typeof androidIdFn === "function") {
      const id = androidIdFn();
      if (id) return String(id);
    }

    // ✅ iOS: IDFV
    const iosIdFn = (Application as any)?.getIosIdForVendorAsync;
    if (typeof iosIdFn === "function") {
      const v = await iosIdFn();
      if (v) return String(v);
    }
  } catch {}

  // fallback stable-ish
  return `${Device.modelName ?? "device"}-${Device.osName ?? "os"}-${Device.osVersion ?? "0"}`;
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const lastSavedRef = useRef<{
    userId: string;
    token: string;
    role: string;
    deviceId: string;
  } | null>(null);

  const registerInFlightRef = useRef(false);

  // ✅ i18n sync guards
  const lastRoleRef = useRef<Role | null>(null);
  const syncingLocaleRef = useRef(false);

  useEffect(() => {
    let alive = true;

    // ✅ Notifications handler (safe, idempotent)
    setupNotifications();

    const syncLocale = async () => {
      if (!alive) return;
      if (syncingLocaleRef.current) return;
      syncingLocaleRef.current = true;

      try {
        const role = toRole((await getSelectedRole()) ?? "client");
        await syncLocaleForRole(role as any);
        lastRoleRef.current = role;
      } catch (e) {
        console.log("syncLocale error:", e);
        // fallback safe
        try {
          await syncLocaleForRole("client" as any);
          lastRoleRef.current = "client";
        } catch {}
      } finally {
        syncingLocaleRef.current = false;
      }
    };

    const registerToken = async (userId: string) => {
      try {
        if (!alive) return;
        if (registerInFlightRef.current) return;
        registerInFlightRef.current = true;

        console.log("👤 USER ID (session):", userId);

        const expoToken = await getExpoPushToken();
        console.log("📲 EXPO PUSH TOKEN:", expoToken);

        if (!expoToken) {
          console.log("❌ Pas de token (permissions refusées / simulateur / limitation)");
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
          console.log("↩️ Token déjà enregistré (même device/role), skip");
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
          console.log("❌ Save token error:", error);
          return;
        }

        lastSavedRef.current = { userId, token: expoToken, role, deviceId };
        console.log("✅ Token enregistré dans user_push_tokens (multi-device)");
      } finally {
        registerInFlightRef.current = false;
      }
    };

    // ✅ boot: i18n + session
    (async () => {
      await syncLocale();

      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!alive) return;
          const s = data.session ?? null;
          setSession(s);
          setAuthLoading(false);
          if (s?.user?.id) void registerToken(s.user.id);
        })
        .catch(() => {
          if (!alive) return;
          setAuthLoading(false);
        });
    })();

    // ✅ auth changes => sync locale + token
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!alive) return;
      const s = newSession ?? null;
      setSession(s);
      setAuthLoading(false);
      void syncLocale();
      if (s?.user?.id) void registerToken(s.user.id);
    });

    // ✅ role changes without auth change (RoleSelect) => poll léger
    const rolePoll = setInterval(() => {
      void (async () => {
        try {
          const role = toRole((await getSelectedRole()) ?? "client");
          if (lastRoleRef.current !== role) {
            await syncLocale();
          }
        } catch {}
      })();
    }, 1500);

    return () => {
      alive = false;
      clearInterval(rolePoll);
      try {
        sub?.subscription?.unsubscribe?.();
      } catch {}
    };
  }, []);

  const initialRouteName = useMemo(() => {
    return session ? "ClientHome" : "RoleSelect";
  }, [session]);

  // ✅ Force un remount du navigator quand session change
  const navKey = session?.user?.id ? `authed-${session.user.id}` : "guest";

  if (authLoading) return <Splash />;

  if (isExpoGo()) {
    return (
      <View style={{ flex: 1 }}>
        <AppNavigator key={navKey} initialRouteName={initialRouteName} />
      </View>
    );
  }

  const StripeGate = require("./src/lib/StripeGate").default;
  return (
    <View style={{ flex: 1 }}>
      <StripeGate key={navKey} initialRouteName={initialRouteName} />
    </View>
  );
}