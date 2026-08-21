import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import Constants from "expo-constants";
import { ensureMapboxTokenApplied } from "../lib/mapboxConfig";
import {
  formatBootError,
  logStartupProbe,
  reportBootError,
} from "../lib/startupProbe";
import { BOOT_SHELL_TIMEOUT_MS, withTimeout } from "../lib/bootFailOpen";
import { NetworkBanner } from "./NetworkBanner";

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

async function loadNavigatorOnly(): Promise<StripeGateComponent> {
  const navModule = await import("../navigation/AppNavigator");
  return ({ initialRouteName: routeName }) => (
    <navModule.AppNavigator initialRouteName={routeName as never} />
  );
}

export function AppRootShell({
  initialRouteName,
  navKey,
}: AppRootShellProps): React.JSX.Element {
  const [boot, setBoot] = useState<BootState>({ status: "loading" });
  const [bootAttempt, setBootAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setBoot({ status: "loading" });

    void (async () => {
      logStartupProbe("shell-import-start");

      try {
        ensureMapboxTokenApplied();

        const bootImport = (async (): Promise<StripeGateComponent> => {
          if (isExpoGo()) {
            return loadNavigatorOnly();
          }

          try {
            const stripeModule = await import("../lib/StripeGate");
            const StripeGate = (stripeModule.default ??
              stripeModule) as StripeGateComponent;
            if (!StripeGate) {
              throw new Error("StripeGate export missing");
            }
            return StripeGate;
          } catch (stripeErr) {
            reportBootError("stripe-gate-import-fallback", stripeErr);
            // Fail open: Login / RoleSelect must still render without Stripe.
            return loadNavigatorOnly();
          }
        })();

        const StripeGate = await withTimeout(
          bootImport,
          BOOT_SHELL_TIMEOUT_MS,
          "shell_import",
        );

        if (!alive) return;
        setBoot({ status: "ready", StripeGate });
        logStartupProbe("shell-import-ready");
      } catch (error) {
        reportBootError("shell-import-failed", error);
        if (!alive) return;

        // Last resort: try navigator-only without timeout wrapper leftover.
        try {
          const StripeGate = await withTimeout(
            loadNavigatorOnly(),
            BOOT_SHELL_TIMEOUT_MS,
            "shell_navigator_fallback",
          );
          if (!alive) return;
          setBoot({ status: "ready", StripeGate });
          logStartupProbe("shell-import-navigator-fallback");
        } catch (fallbackError) {
          reportBootError("shell-import-fallback-failed", fallbackError);
          if (!alive) return;
          setBoot({
            status: "error",
            message: formatBootError(error),
          });
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [bootAttempt]);

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          onPress={() => setBootAttempt((n) => n + 1)}
          style={{
            marginTop: 24,
            alignSelf: "flex-start",
            backgroundColor: "#F8FAFC",
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 10,
          }}
        >
          <Text style={{ color: "#111827", fontWeight: "700" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <NetworkBanner />
      <boot.StripeGate key={navKey} initialRouteName={initialRouteName} />
    </View>
  );
}
