import * as React from "react";
import { AppState } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

// ✅ Guard global
import { supabase } from "../lib/supabase";
import { getSelectedRole } from "../lib/authRole";

// ✅ Driver Tabs (bottom navigation)
import { DriverTabs } from "./DriverTabs";

// Écrans principaux
import { HomeScreen } from "../screens/HomeScreen";
import { RoleSelectScreen } from "../screens/RoleSelectScreen";

// ✅ Delivery request
import DeliveryRequestScreen from "../screens/DeliveryRequestScreen";

// Client
import { ClientHomeScreen } from "../screens/ClientHomeScreen";
import { ClientNewOrderScreen } from "../screens/ClientNewOrderScreen";
import { ClientRestaurantListScreen } from "../screens/ClientRestaurantListScreen";
import { ClientRestaurantMenuScreen } from "../screens/ClientRestaurantMenuScreen";
import { ClientOrderDetailsScreen } from "../screens/ClientOrderDetailsScreen";
import { ClientDeliveryRequestDetailsScreen } from "../screens/ClientDeliveryRequestDetailsScreen";

// ✅ Client Auth
import { ClientAuthScreen } from "../screens/ClientAuthScreen";

// ✅ Client Profile
import { ClientProfileScreen } from "../screens/ClientProfileScreen";

// Client Inbox + Chat
import { ClientInboxScreen } from "../screens/ClientInboxScreen";
import { ClientChatScreen } from "../screens/ClientChatScreen";

// Driver (stack screens hors tabs)
import { DriverOrderDetailsScreen } from "../screens/DriverOrderDetailsScreen";
import DriverMapScreen from "../screens/DriverMapScreen";

// ✅ Onboarding
import { DriverOnboardingScreen } from "../screens/DriverOnboardingScreen";

// ✅ Driver Auth
import { DriverAuthScreen } from "../screens/DriverAuthScreen";

// ✅ Restaurant Auth
import { RestaurantAuthScreen } from "../screens/RestaurantAuthScreen";

// Driver Chat
import { DriverChatScreen } from "../screens/DriverChatScreen";

// Driver Menu screens
import { DriverProfileScreen } from "../screens/DriverProfileScreen";
import { DriverReferralsScreen } from "../screens/DriverReferralsScreen";
import { DriverOpportunitiesScreen } from "../screens/DriverOpportunitiesScreen";
import { DriverAccountScreen } from "../screens/DriverAccountScreen";
import { DriverHelpScreen } from "../screens/DriverHelpScreen";
import { DriverWorkAccountScreen } from "../screens/DriverWorkAccountScreen";
import { DriverSecurityScreen } from "../screens/DriverSecurityScreen";
import { DriverLanguageScreen } from "../screens/DriverLanguageScreen";

// ✅ NEW: Driver Tax Screen
import DriverTaxScreen from "../screens/DriverTaxScreen";
import DriverW9Screen from "../screens/DriverW9Screen";

// Revenus pages
import { DriverRevenueDetailsScreen } from "../screens/DriverRevenueDetailsScreen";
import { DriverRevenueHistoryScreen } from "../screens/DriverRevenueHistoryScreen";
import { DriverWalletScreen } from "../screens/DriverWalletScreen";
import { DriverBenefitsScreen } from "../screens/DriverBenefitsScreen";

// Restaurant
import { RestaurantHomeScreen } from "../screens/RestaurantHomeScreen";
import { RestaurantOrdersScreen } from "../screens/RestaurantOrdersScreen";
import { RestaurantOrderDetailsScreen } from "../screens/RestaurantOrderDetailsScreen";
import { RestaurantEarningsScreen } from "../screens/RestaurantEarningsScreen";
import RestaurantTaxScreen from "../screens/RestaurantTaxScreen";
import { RestaurantLanguageScreen } from "../screens/RestaurantLanguageScreen";
import { RestaurantSecurityScreen } from "../screens/RestaurantSecurityScreen";

// ✅ Restaurant Setup Flow (Uber-like)
import RestaurantGateScreen from "../screens/restaurant/RestaurantGateScreen";
import RestaurantSetupScreen from "../screens/restaurant/RestaurantSetupScreen";
import RestaurantMenuScreen from "../screens/restaurant/RestaurantMenuScreen";

// Restaurant Chat
import { RestaurantChatScreen } from "../screens/RestaurantChatScreen";

export type RootStackParamList = {
  Home: undefined;
  RoleSelect: undefined;

  // ✅ Delivery request
  DeliveryRequest: undefined;

  // ✅ Auth
  ClientAuth: undefined;
  DriverAuth: undefined;
  RestaurantAuth: undefined;

  // ✅ Client Profile
  ClientProfile: undefined;

  // ✅ Restaurant Setup Flow
  RestaurantGate: undefined;
  RestaurantSetup: undefined;
  RestaurantMenu: undefined;

  // Client
  ClientHome: undefined;
  ClientNewOrder: undefined;
  ClientRestaurantList: undefined;
  ClientRestaurantMenu: { restaurantId: string; restaurantName: string };
  ClientOrderDetails: { orderId: string };
  ClientDeliveryRequestDetails: { requestId: string };

  // Client Inbox + Chat
  ClientInbox: undefined;
  ClientChat: { orderId: string };

  // ✅ Driver (Tabs root)
  DriverTabs: undefined;

  // Driver stack screens (hors tabs)
  DriverOrderDetails: { orderId: string };
  DriverMap: undefined;
  DriverChat: { orderId: string };

  // ✅ Onboarding
  DriverOnboarding: undefined;

  // Driver Menu
  DriverProfile: undefined;
  DriverReferrals: undefined;
  DriverOpportunities: undefined;
  DriverAccount: undefined;
  DriverHelp: undefined;
  DriverWorkAccount: undefined;
  DriverSecurity: undefined;
  DriverLanguage: undefined;

  // ✅ NEW: Tax
  DriverTax: undefined;
  DriverW9: undefined;

  // Revenus details
  DriverRevenueDetails: { range: "week" | "today" | "month" };
  DriverRevenueHistory: { range: "week" | "today" | "month" };
  DriverWallet: undefined;
  DriverBenefits: undefined;

  // Restaurant
  RestaurantHome: undefined;
  RestaurantOrders: undefined;
  RestaurantOrderDetails: { orderId: string };
  RestaurantEarnings: undefined;
  RestaurantTax: undefined;
  RestaurantLanguage: undefined;
  RestaurantSecurity: undefined;

  // Restaurant Chat
  RestaurantChat: { orderId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

type AppNavigatorProps = {
  initialRouteName?: keyof RootStackParamList;
};

export function AppNavigator({
  initialRouteName = "RoleSelect",
}: AppNavigatorProps) {
  const { i18n } = useTranslation();

  // ✅ On garde la valeur (debug / tracking), MAIS on ne remount pas la navigation
  const langKey =
    (i18n.resolvedLanguage || i18n.language || "en").toLowerCase();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _langForDebug = langKey;

  const navRef = React.useRef<any>(null);
  const bootedRef = React.useRef(false);
  const syncingRef = React.useRef(false);

  // ✅ Coalescing: évite plusieurs sync() en rafale
  const pendingRef = React.useRef(false);

  const navReady = React.useCallback(() => {
    return !!navRef.current?.isReady?.();
  }, []);

  const currentRoute = React.useCallback(():
    | keyof RootStackParamList
    | undefined => {
    if (!navReady()) return undefined;
    return navRef.current?.getCurrentRoute?.()?.name as
      | keyof RootStackParamList
      | undefined;
  }, [navReady]);

  const resetTo = React.useCallback(
    (name: keyof RootStackParamList) => {
      if (!navReady()) return;

      const cur = currentRoute();
      if (cur === name) return;

      navRef.current?.reset({
        index: 0,
        routes: [{ name }],
      });
    },
    [currentRoute, navReady]
  );

  const isInClientArea = React.useCallback((r?: keyof RootStackParamList) => {
    if (!r) return false;
    return (
      r === "ClientHome" ||
      r === "ClientNewOrder" ||
      r === "DeliveryRequest" ||
      r === "ClientRestaurantList" ||
      r === "ClientRestaurantMenu" ||
      r === "ClientOrderDetails" ||
      r === "ClientDeliveryRequestDetails" ||
      r === "ClientInbox" ||
      r === "ClientChat" ||
      r === "ClientProfile"
    );
  }, []);

  const isInDriverArea = React.useCallback((r?: keyof RootStackParamList) => {
    if (!r) return false;
    return (
      r === "DriverTabs" ||
      r === "DriverOrderDetails" ||
      r === "DriverMap" ||
      r === "DriverChat" ||
      r === "DriverOnboarding" ||
      r === "DriverProfile" ||
      r === "DriverReferrals" ||
      r === "DriverOpportunities" ||
      r === "DriverAccount" ||
      r === "DriverHelp" ||
      r === "DriverWorkAccount" ||
      r === "DriverSecurity" ||
      r === "DriverLanguage" ||
      r === "DriverTax" ||
      r === "DriverW9" ||
      r === "DriverRevenueDetails" ||
      r === "DriverRevenueHistory" ||
      r === "DriverWallet" ||
      r === "DriverBenefits"
    );
  }, []);

  const isInRestaurantArea = React.useCallback(
    (r?: keyof RootStackParamList) => {
      if (!r) return false;
      return (
        r === "RestaurantHome" ||
        r === "RestaurantOrders" ||
        r === "RestaurantOrderDetails" ||
        r === "RestaurantEarnings" ||
        r === "RestaurantTax" ||
        r === "RestaurantLanguage" ||
        r === "RestaurantSecurity" ||
        r === "RestaurantChat" ||
        r === "RestaurantGate" ||
        r === "RestaurantSetup" ||
        r === "RestaurantMenu"
      );
    },
    []
  );

  const isClientProfileComplete = React.useCallback(
    async (uid: string): Promise<boolean> => {
      try {
        const { data, error } = await supabase
          .from("client_profiles")
          .select("phone, address, full_name, avatar_url")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) {
          console.log("client_profiles check error (ignored):", error);
          return true;
        }

        const phoneOk = !!(data as any)?.phone?.trim?.();
        const addrOk = !!(data as any)?.address?.trim?.();
        const nameOk = !!(data as any)?.full_name?.trim?.();
        const avatarOk = !!(data as any)?.avatar_url?.trim?.();

        return phoneOk && addrOk && nameOk && avatarOk;
      } catch (e) {
        console.log("client profile complete check failed (ignored):", e);
        return true;
      }
    },
    []
  );

  const isRestaurantProfileComplete = React.useCallback(
    async (uid: string): Promise<boolean> => {
      try {
        const { data, error } = await supabase
          .from("restaurant_profiles")
          .select("user_id, restaurant_name, address, city, postal_code")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) {
          console.log("restaurant_profiles check error:", error);
          return false;
        }
        if (!data) return false;

        const nameOk = !!(data as any)?.restaurant_name?.trim?.();
        const addrOk = !!(data as any)?.address?.trim?.();
        const cityOk = !!(data as any)?.city?.trim?.();
        const zipOk = !!(data as any)?.postal_code?.trim?.();

        return nameOk && addrOk && cityOk && zipOk;
      } catch (e) {
        console.log("restaurant profile complete check failed:", e);
        return false;
      }
    },
    []
  );

  const sync = React.useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      if (!navReady()) return;

      const { data } = await supabase.auth.getSession();
      const session = data.session ?? null;
      const role = await getSelectedRole();

      const cur = currentRoute();

      if (!session) {
        if (
          cur === "RoleSelect" ||
          cur === "ClientAuth" ||
          cur === "DriverAuth" ||
          cur === "RestaurantAuth"
        ) {
          return;
        }
        resetTo("RoleSelect");
        return;
      }

      const uid = session.user.id;

      if (role === "client") {
        const ok = await isClientProfileComplete(uid);
        if (!ok) {
          if (cur !== "ClientProfile") resetTo("ClientProfile");
          return;
        }
        if (isInClientArea(cur)) return;
        resetTo("ClientHome");
        return;
      }

      if (role === "driver") {
        if (isInDriverArea(cur)) return;
        resetTo("DriverTabs");
        return;
      }

      if (role === "restaurant") {
        if (isInRestaurantArea(cur)) return;
        await isRestaurantProfileComplete(uid);
        resetTo("RestaurantGate");
        return;
      }

      resetTo("RoleSelect");
    } finally {
      syncingRef.current = false;
    }
  }, [
    navReady,
    currentRoute,
    resetTo,
    isClientProfileComplete,
    isRestaurantProfileComplete,
    isInClientArea,
    isInDriverArea,
    isInRestaurantArea,
  ]);

  const scheduleSync = React.useCallback(() => {
    if (pendingRef.current) return;
    pendingRef.current = true;

    setTimeout(() => {
      pendingRef.current = false;
      void sync();
    }, 0);
  }, [sync]);

  React.useEffect(() => {
    let alive = true;

    if (!bootedRef.current) {
      bootedRef.current = true;
      setTimeout(() => {
        if (alive) scheduleSync();
      }, 0);
    } else {
      scheduleSync();
    }

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      if (!alive) return;
      scheduleSync();
    });

    const appStateSub = AppState.addEventListener("change", (st) => {
      if (!alive) return;
      if (st === "active") scheduleSync();
    });

    return () => {
      alive = false;
      try {
        sub?.subscription?.unsubscribe?.();
      } catch {}
      try {
        appStateSub?.remove?.();
      } catch {}
    };
  }, [scheduleSync]);

  return (
    <NavigationContainer ref={navRef} onReady={scheduleSync}>
      <Stack.Navigator
        id="root-stack"
        initialRouteName={initialRouteName}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />

        {/* ✅ Delivery request */}
        <Stack.Screen
          name="DeliveryRequest"
          component={DeliveryRequestScreen}
        />

        {/* ✅ Auth */}
        <Stack.Screen name="ClientAuth" component={ClientAuthScreen} />
        <Stack.Screen name="DriverAuth" component={DriverAuthScreen} />
        <Stack.Screen name="RestaurantAuth" component={RestaurantAuthScreen} />

        {/* ✅ Client Profile */}
        <Stack.Screen name="ClientProfile" component={ClientProfileScreen} />

        {/* ✅ Restaurant Setup Flow */}
        <Stack.Screen name="RestaurantGate" component={RestaurantGateScreen} />
        <Stack.Screen
          name="RestaurantSetup"
          component={RestaurantSetupScreen}
        />
        <Stack.Screen name="RestaurantMenu" component={RestaurantMenuScreen} />

        {/* Client */}
        <Stack.Screen name="ClientHome" component={ClientHomeScreen} />
        <Stack.Screen name="ClientNewOrder" component={ClientNewOrderScreen} />
        <Stack.Screen
          name="ClientRestaurantList"
          component={ClientRestaurantListScreen}
        />
        <Stack.Screen
          name="ClientRestaurantMenu"
          component={ClientRestaurantMenuScreen}
        />
        <Stack.Screen
          name="ClientOrderDetails"
          component={ClientOrderDetailsScreen}
        />
        <Stack.Screen
          name="ClientDeliveryRequestDetails"
          component={ClientDeliveryRequestDetailsScreen}
        />
        <Stack.Screen name="ClientInbox" component={ClientInboxScreen} />
        <Stack.Screen name="ClientChat" component={ClientChatScreen} />

        {/* ✅ Driver */}
        <Stack.Screen name="DriverTabs" component={DriverTabs} />
        <Stack.Screen
          name="DriverOrderDetails"
          component={DriverOrderDetailsScreen}
        />
        <Stack.Screen name="DriverMap" component={DriverMapScreen} />
        <Stack.Screen name="DriverChat" component={DriverChatScreen} />
        <Stack.Screen
          name="DriverOnboarding"
          component={DriverOnboardingScreen}
        />

        {/* Driver Menu */}
        <Stack.Screen name="DriverProfile" component={DriverProfileScreen} />
        <Stack.Screen
          name="DriverReferrals"
          component={DriverReferralsScreen}
        />
        <Stack.Screen
          name="DriverOpportunities"
          component={DriverOpportunitiesScreen}
        />
        <Stack.Screen name="DriverAccount" component={DriverAccountScreen} />
        <Stack.Screen name="DriverHelp" component={DriverHelpScreen} />
        <Stack.Screen
          name="DriverWorkAccount"
          component={DriverWorkAccountScreen}
        />
        <Stack.Screen
          name="DriverSecurity"
          component={DriverSecurityScreen}
        />
        <Stack.Screen
          name="DriverLanguage"
          component={DriverLanguageScreen}
        />

        {/* ✅ NEW: Driver Tax */}
        <Stack.Screen name="DriverTax" component={DriverTaxScreen} />
        <Stack.Screen name="DriverW9" component={DriverW9Screen} />

        {/* Revenus */}
        <Stack.Screen
          name="DriverRevenueDetails"
          component={DriverRevenueDetailsScreen}
        />
        <Stack.Screen
          name="DriverRevenueHistory"
          component={DriverRevenueHistoryScreen}
        />
        <Stack.Screen name="DriverWallet" component={DriverWalletScreen} />
        <Stack.Screen name="DriverBenefits" component={DriverBenefitsScreen} />

        {/* Restaurant */}
        <Stack.Screen name="RestaurantHome" component={RestaurantHomeScreen} />
        <Stack.Screen
          name="RestaurantOrders"
          component={RestaurantOrdersScreen}
        />
        <Stack.Screen
          name="RestaurantOrderDetails"
          component={RestaurantOrderDetailsScreen}
        />
        <Stack.Screen
          name="RestaurantEarnings"
          component={RestaurantEarningsScreen}
        />
        <Stack.Screen name="RestaurantTax" component={RestaurantTaxScreen} />
        <Stack.Screen
          name="RestaurantLanguage"
          component={RestaurantLanguageScreen}
        />
        <Stack.Screen
          name="RestaurantSecurity"
          component={RestaurantSecurityScreen}
        />
        <Stack.Screen name="RestaurantChat" component={RestaurantChatScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}