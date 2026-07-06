import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import Constants from "expo-constants";
import { ensureMapboxTokenApplied } from "../lib/mapboxConfig";
import {
  formatBootError,
  logStartupProbe,
  reportBootError,
} from "../lib/startupProbe";

type StripeGateComponent = React.ComponentType<{
  initialRouteName?: string;
}>;

type AppRootShellProps = {
  initialRouteName: string;
  navKey: string;
};

type BootState =
  | { status: "loading" }
  | {
      status: "ready";
      StripeGate: StripeGateComponent;
    }
  | { status: "error"; message: string };

function isExpoGo(): boolean {
  const ownership = (Constants as { appOwnership?: string } | undefined)?.appOwnership;
  return ownership === "expo";
}

export function AppRootShell({
  initialRouteName,
  navKey,
}: AppRootShellProps): React.JSX.Element {
  const [boot, setBoot] = useState<BootState>({ status: "loading" });

  useEffect(() => {
    let alive = true;

    void (async () => {
      logStartupProbe("shell-import-start");

      try {
        ensureMapboxTokenApplied();

        if (isExpoGo()) {
          const navModule = await import("../navigation/AppNavigator");
          if (!alive) return;
          setBoot({
            status: "ready",
            StripeGate: ({ initialRouteName: routeName }) => (
              <navModule.AppNavigator initialRouteName={routeName as never} />
            ),
          });
          logStartupProbe("shell-import-expo-go-ready");
          return;
        }

        const stripeModule = await import("../lib/StripeGate");
        const StripeGate = (stripeModule.default ?? stripeModule) as StripeGateComponent;

        if (!StripeGate) {
          throw new Error("StripeGate export missing");
        }

        if (!alive) return;
        setBoot({ status: "ready", StripeGate });
        logStartupProbe("shell-import-ready");
      } catch (error) {
        reportBootError("shell-import-failed", error);
        if (!alive) return;
        setBoot({
          status: "error",
          message: formatBootError(error),
        });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (boot.status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#111827",
          padding: 24,
        }}
      >
        <ActivityIndicator size="large" color="#FFFFFF" />
        <Text style={{ color: "#E5E7EB", marginTop: 16 }}>Chargement MMD…</Text>
      </View>
    );
  }

  if (boot.status === "error") {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#450A0A",
          padding: 24,
          paddingTop: 56,
        }}
      >
        <Text style={{ color: "#FEE2E2", fontSize: 18, fontWeight: "800" }}>
          Module natif / navigation indisponible
        </Text>
        <Text
          style={{
            color: "#F8FAFC",
            marginTop: 16,
            fontFamily: "Menlo",
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {boot.message}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <boot.StripeGate key={navKey} initialRouteName={initialRouteName} />
    </View>
  );
}
