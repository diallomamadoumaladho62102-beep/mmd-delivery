import * as React from "react";
import { AppState } from "react-native";
import * as Linking from "expo-linking";
import {
  CANONICAL_APP_SCHEME,
  LEGACY_APP_SCHEME,
  MOBILE_LINKING_SCREEN_PATHS,
  normalizeDeepLinkUrl,
} from "../lib/deepLinks";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";

import {
  accountStatusBlockMessage,
  isAccountActive,
  isRestaurantOrderEligible,
} from "../lib/accountStatus";
import { supabase } from "../lib/supabase";
import { getSelectedRole } from "../lib/authRole";

import { DriverTabs } from "./DriverTabs";

import { HomeScreen } from "../screens/HomeScreen";
import { RoleSelectScreen } from "../screens/RoleSelectScreen";
import ResetPasswordScreen from "../screens/ResetPasswordScreen";

import DeliveryRequestScreen from "../screens/DeliveryRequestScreen";

import { ClientHomeScreen } from "../screens/ClientHomeScreen";
import MmdAiScreen from "../screens/MmdAiScreen";
import { ClientNewOrderScreen } from "../screens/ClientNewOrderScreen";
import { ClientRestaurantListScreen } from "../screens/ClientRestaurantListScreen";
import { ClientRestaurantMenuScreen } from "../screens/ClientRestaurantMenuScreen";
import { ClientOrderDetailsScreen } from "../screens/ClientOrderDetailsScreen";
import { ClientDeliveryRequestDetailsScreen } from "../screens/ClientDeliveryRequestDetailsScreen";
import { ClientAuthScreen } from "../screens/ClientAuthScreen";
import { ClientProfileScreen } from "../screens/ClientProfileScreen";
import { ClientInboxScreen } from "../screens/ClientInboxScreen";
import { ClientChatScreen } from "../screens/ClientChatScreen";

import { DriverOrderDetailsScreen } from "../screens/DriverOrderDetailsScreen";
import DriverMapScreen from "../screens/DriverMapScreen";
import { DriverOnboardingScreen } from "../screens/DriverOnboardingScreen";
import { DriverIdentityVerificationScreen } from "../screens/DriverIdentityVerificationScreen";
import { DriverAuthScreen } from "../screens/DriverAuthScreen";
import { DriverChatScreen } from "../screens/DriverChatScreen";

import { DriverProfileScreen } from "../screens/DriverProfileScreen";
import { DriverReferralsScreen } from "../screens/DriverReferralsScreen";
import { DriverOpportunitiesScreen } from "../screens/DriverOpportunitiesScreen";
import { DriverAccountScreen } from "../screens/DriverAccountScreen";
import { DriverHelpScreen } from "../screens/DriverHelpScreen";
import { DriverWorkAccountScreen } from "../screens/DriverWorkAccountScreen";
import DriverPrivacyScreen from "../screens/DriverPrivacyScreen";
import DriverAboutScreen from "../screens/DriverAboutScreen";
import { DriverSecurityScreen } from "../screens/DriverSecurityScreen";
import { DriverLanguageScreen } from "../screens/DriverLanguageScreen";

import DriverTaxScreen from "../screens/DriverTaxScreen";
import DriverW9Screen from "../screens/DriverW9Screen";

import { DriverRevenueDetailsScreen } from "../screens/DriverRevenueDetailsScreen";
import { DriverRevenueHistoryScreen } from "../screens/DriverRevenueHistoryScreen";
import { DriverWalletScreen } from "../screens/DriverWalletScreen";
import { DriverServicesScreen } from "../screens/driver/DriverServicesScreen";
import { DriverVehicleScreen } from "../screens/driver/DriverVehicleScreen";
import { DriverVehiclesScreen } from "../screens/driver/DriverVehiclesScreen";
import { DriverBenefitsScreen } from "../screens/DriverBenefitsScreen";

import { RestaurantAuthScreen } from "../screens/RestaurantAuthScreen";
import { RestaurantHomeScreen } from "../screens/RestaurantHomeScreen";
import { RestaurantOrdersScreen } from "../screens/RestaurantOrdersScreen";
import { RestaurantOrderDetailsScreen } from "../screens/RestaurantOrderDetailsScreen";
import { RestaurantEarningsScreen } from "../screens/RestaurantEarningsScreen";
import RestaurantFinancialCenterScreen from "../screens/RestaurantFinancialCenterScreen";
import RestaurantTaxScreen from "../screens/RestaurantTaxScreen";
import { RestaurantLanguageScreen } from "../screens/RestaurantLanguageScreen";
import { RestaurantSecurityScreen } from "../screens/RestaurantSecurityScreen";
import { RestaurantOrderAutomationScreen } from "../screens/restaurant/RestaurantOrderAutomationScreen";
import RestaurantGateScreen from "../screens/restaurant/RestaurantGateScreen";
import RestaurantSetupScreen from "../screens/restaurant/RestaurantSetupScreen";
import RestaurantMenuScreen from "../screens/restaurant/RestaurantMenuScreen";
import RestaurantCommandCenterScreen from "../screens/restaurant/RestaurantCommandCenterScreen";
import { RestaurantChatScreen } from "../screens/RestaurantChatScreen";
import SellerGateScreen from "../screens/seller/SellerGateScreen";
import SellerOnboardingScreen from "../screens/seller/SellerOnboardingScreen";
import SellerDashboardScreen from "../screens/seller/SellerDashboardScreen";
import SellerProductsScreen from "../screens/seller/SellerProductsScreen";
import SellerOrdersScreen from "../screens/seller/SellerOrdersScreen";
import MarketplaceHomeScreen from "../screens/marketplace/MarketplaceHomeScreen";
import MarketplaceProductListScreen from "../screens/marketplace/MarketplaceProductListScreen";
import MarketplaceProductDetailsScreen from "../screens/marketplace/MarketplaceProductDetailsScreen";
import MarketplaceCartScreen from "../screens/marketplace/MarketplaceCartScreen";

import LocationPickerTestScreen from "../screens/LocationPickerTestScreen";
import MMDLocationPickerScreen from "../screens/MMDLocationPickerScreen";
import type { MmdLocationPickerResult } from "../lib/mmdLocationDisplay";
import TaxiHomeScreen from "../screens/taxi/TaxiHomeScreen";
import TaxiQuoteScreen from "../screens/taxi/TaxiQuoteScreen";
import TaxiFavoritesScreen from "../screens/taxi/TaxiFavoritesScreen";
import TaxiLoyaltyScreen from "../screens/taxi/TaxiLoyaltyScreen";
import TaxiScheduledScreen from "../screens/taxi/TaxiScheduledScreen";
import TaxiScheduledBookScreen from "../screens/taxi/TaxiScheduledBookScreen";
import TaxiMultiStopScreen from "../screens/taxi/TaxiMultiStopScreen";
import TaxiLoyaltyRewardsScreen from "../screens/taxi/TaxiLoyaltyRewardsScreen";
import TaxiRideTrackingScreen from "../screens/taxi/TaxiRideTrackingScreen";
import TaxiHistoryScreen from "../screens/taxi/TaxiHistoryScreen";
import TaxiChatScreen from "../screens/taxi/TaxiChatScreen";
import DriverTaxiChatScreen from "../screens/taxi/DriverTaxiChatScreen";
import * as Notifications from "expo-notifications";
import {
  extractTaxiPushPayload,
  notifyTaxiOfferPushReceived,
} from "../lib/taxiPushEvents";

export type RootStackParamList = {
  Home: undefined;
  RoleSelect: undefined;
  ResetPassword: undefined;

  DeliveryRequest:
    | {
        dropoffLocationId?: string;
        locationPickerResult?: MmdLocationPickerResult;
      }
    | undefined;

  ClientAuth: undefined;
  DriverAuth: { ref?: string; code?: string } | undefined;
  RestaurantAuth: undefined;

  ClientProfile: undefined;
  LocationPickerTest: undefined;
  MMDLocationPicker: {
    countryCode?: string;
    title?: string;
    submitLabel?: string;
    returnTo: "TaxiHome" | "TaxiQuote" | "DeliveryRequest" | "MarketplaceCart";
    pickerContext:
      | "taxi_pickup"
      | "taxi_dropoff"
      | "taxi_quote_pickup"
      | "taxi_quote_dropoff"
      | "delivery_dropoff"
      | "marketplace_dropoff";
  };

  RestaurantGate: undefined;
  RestaurantSetup: undefined;
  RestaurantMenu: undefined;

  SellerGate: undefined;
  SellerOnboarding: undefined;
  SellerDashboard: undefined;
  SellerProducts: undefined;
  SellerOrders: undefined;

  MarketplaceHome: undefined;
  MarketplaceProductList: {
    sellerId: string;
    sellerName: string;
    sellerCountryCode?: string;
    sellerIsOpen?: boolean;
  };
  MarketplaceProductDetails: {
    sellerId: string;
    sellerName: string;
    productId: string;
    sellerCountryCode?: string;
  };
  MarketplaceCart: {
    sellerId: string;
    sellerName: string;
    sellerCountryCode?: string;
    orderId?: string;
    locationPickerResult?: MmdLocationPickerResult;
  };

  ClientHome: undefined;
  ClientNewOrder: undefined;
  ClientRestaurantList: undefined;
  ClientRestaurantMenu: { restaurantId: string; restaurantName: string };
  ClientOrderDetails: { orderId: string };
  ClientDeliveryRequestDetails: { requestId: string };
  ClientInbox: undefined;
  ClientChat: {
    orderId: string;
    targetRole?: "restaurant" | "driver" | "admin" | "";
  };

  MmdAi:
    | {
        initialPrompt?: string;
        orderId?: string;
        source?: "home_tab" | "search" | "order";
      }
    | undefined;

  TaxiHome:
    | {
        pickupLocationId?: string;
        dropoffLocationId?: string;
        locationPickerResult?: MmdLocationPickerResult;
      }
    | undefined;
  TaxiQuote: {
    pickupAddress: string;
    dropoffAddress: string;
    pickupLocationId?: string;
    dropoffLocationId?: string;
    vehicleClass: string;
    countryCode?: string;
    countryResolution?: Record<string, unknown>;
    quote: Record<string, unknown>;
    route: Record<string, unknown>;
    locationPickerResult?: MmdLocationPickerResult;
    preferElectricOrHybrid?: boolean;
    clientPreferences?: Record<string, boolean>;
    ambiancePreference?: "quiet" | "music" | "conversation" | "none";
  };
  TaxiRideTracking: { rideId: string };
  TaxiHistory: undefined;
  TaxiFavorites: undefined;
  TaxiLoyalty: undefined;
  TaxiScheduled: undefined;
  TaxiScheduledBook: undefined;
  TaxiMultiStop: undefined;
  TaxiLoyaltyRewards: undefined;
  TaxiChat: { rideId: string };

  DriverTabs: undefined;
  DriverOrderDetails: {
    orderId: string;
    sourceTable?: "orders" | "delivery_requests" | "taxi_rides" | "marketplace_delivery_jobs";
    source_table?: "orders" | "delivery_requests" | "taxi_rides" | "marketplace_delivery_jobs";
  };
  DriverMap: {
    orderId: string;
    sourceTable?: "orders" | "delivery_requests" | "taxi_rides" | "marketplace_delivery_jobs";
    destinationStage?: "pickup" | "dropoff";
    previewProgress?: number;
  };
  DriverTaxiChat: { rideId: string };
  DriverChat: {
    orderId: string;
    targetRole?: "client" | "restaurant" | "admin" | "";
  };
  DriverOnboarding: undefined;
  DriverIdentityVerification: undefined;

  DriverProfile: undefined;
  DriverReferrals: undefined;
  DriverOpportunities: undefined;
  DriverAccount: undefined;
  DriverHelp: undefined;
  DriverWorkAccount: undefined;
  DriverPrivacyScreen: undefined;
  DriverAboutScreen: undefined;
  DriverSecurity: undefined;
  DriverLanguage: undefined;

  DriverTax: undefined;
  DriverW9: undefined;

  DriverRevenueDetails: { range: "week" | "today" | "month" };
  DriverRevenueHistory: { range: "week" | "today" | "month" };
  DriverWallet: undefined;
  DriverServices: undefined;
  DriverVehicles: undefined;
  DriverVehicle: { vehicleId?: string } | undefined;
  DriverBenefits: undefined;

  RestaurantHome: undefined;
  RestaurantCommandCenter: undefined;
  RestaurantOrders: undefined;
  RestaurantOrderDetails: { orderId: string };
  RestaurantEarnings: undefined;
  RestaurantFinancialCenter: undefined;
  RestaurantTax: undefined;
  RestaurantLanguage: undefined;
  RestaurantSecurity: undefined;
  RestaurantOrderAutomation: undefined;
  RestaurantChat: {
    orderId: string;
    targetRole?: "client" | "driver" | "admin" | "";
  };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const MMD_WEB_DOMAIN = "https://mmddelivery.com";
const MMD_WEB_WWW_DOMAIN = "https://www.mmddelivery.com";
const MMD_LEGACY_WEB_DOMAIN = "https://mmd-delivery.vercel.app";

type AppNavigatorProps = {
  initialRouteName?: keyof RootStackParamList;
};

type DriverStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "incomplete"
  | "suspended"
  | "disabled";

type AppRole = "client" | "driver" | "restaurant" | "seller" | "admin" | null;

function normalizeAppRole(value: unknown): AppRole {
  const role = String(value ?? "").trim().toLowerCase();

  if (role === "client") return "client";
  if (role === "driver" || role === "livreur") return "driver";
  if (role === "restaurant") return "restaurant";
  if (role === "seller") return "seller";
  if (role === "admin") return "admin";

  return null;
}

function isResetPasswordUrl(url: string | null | undefined) {
  if (!url) return false;
  const normalized = (normalizeDeepLinkUrl(url) ?? url).toLowerCase();

  return (
    normalized.includes("auth/reset-password") ||
    normalized.includes("reset-password") ||
    normalized.includes("type=recovery") ||
    normalized.includes("type%3drecovery")
  );
}

function cleanReferralCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/^ref=/i, "")
    .replace(/^code=/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .toUpperCase();

  return cleaned.length >= 4 ? cleaned : null;
}

function extractReferralCodeFromUrl(url: string | null | undefined): string | null {
  const normalized = normalizeDeepLinkUrl(url);
  if (!normalized) return null;

  try {
    const parsed = Linking.parse(normalized);
    const qp = parsed.queryParams ?? {};

    const fromRef = cleanReferralCode((qp as any).ref);
    if (fromRef) return fromRef;

    const fromCode = cleanReferralCode((qp as any).code);
    if (fromCode) return fromCode;

    const path = String(parsed.path ?? "").replace(/^\/+/, "");
    const parts = path.split("/").filter(Boolean);

    if (parts[0]?.toLowerCase() === "r" && parts[1]) {
      return cleanReferralCode(parts[1]);
    }

    // Referral links must stay limited to referral-specific paths.
    // Signup deep links: mmddelivery://signup/* (canonical) and legacy mmd://signup/*
    return null;
  } catch {
    return null;
  }
}

export function AppNavigator({
  initialRouteName = "RoleSelect",
}: AppNavigatorProps) {
  const { i18n } = useTranslation();

  const langKey =
    (i18n.resolvedLanguage || i18n.language || "en").toLowerCase();

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _langForDebug = langKey;

  const navRef = React.useRef<any>(null);
  const bootedRef = React.useRef(false);
  const syncingRef = React.useRef(false);
  const pendingRef = React.useRef(false);
  const resetPasswordFlowRef = React.useRef(false);

  const linking = React.useMemo(
    () => ({
      prefixes: [
        CANONICAL_APP_SCHEME,
        LEGACY_APP_SCHEME,
        Linking.createURL("/"),
        MMD_WEB_DOMAIN,
        MMD_WEB_WWW_DOMAIN,
        MMD_LEGACY_WEB_DOMAIN,
      ],
      config: {
        screens: {
          ResetPassword: MOBILE_LINKING_SCREEN_PATHS.ResetPassword,
          ClientAuth: MOBILE_LINKING_SCREEN_PATHS.ClientAuth,
          DriverAuth: MOBILE_LINKING_SCREEN_PATHS.DriverAuth,
          RestaurantAuth: MOBILE_LINKING_SCREEN_PATHS.RestaurantAuth,
        },
      },
    }),
    []
  );

  const navReady = React.useCallback(() => {
    return !!navRef.current?.isReady?.();
  }, []);

  React.useEffect(() => {
    function handleTaxiPush(data: unknown) {
      const payload = extractTaxiPushPayload(data);
      if (payload.type !== "taxi_offer_dispatch") return;

      notifyTaxiOfferPushReceived();

      if (navReady()) {
        navRef.current?.navigate("DriverTabs");
      }
    }

    const sub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        handleTaxiPush(response.notification.request.content.data);
      }
    );

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleTaxiPush(response.notification.request.content.data);
      }
    });

    return () => {
      sub.remove();
    };
  }, [navReady]);

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

  const getAccountStatus = React.useCallback(async (uid: string): Promise<string> => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("account_status")
        .eq("id", uid)
        .maybeSingle();

      if (error) {
        console.log("profiles account_status check error:", error.message);
        return "unknown";
      }
      return String((data as { account_status?: string } | null)?.account_status ?? "active");
    } catch {
      return "unknown";
    }
  }, []);

  const getRestaurantStatus = React.useCallback(async (uid: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from("restaurant_profiles")
        .select("status")
        .eq("user_id", uid)
        .maybeSingle();

      if (error) return null;
      return String((data as { status?: string } | null)?.status ?? null);
    } catch {
      return null;
    }
  }, []);

  const resolveUserRole = React.useCallback(async (uid: string): Promise<AppRole> => {
    const selectedRole = normalizeAppRole(await getSelectedRole());
    if (selectedRole === "seller") return "seller";

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .maybeSingle();

      if (!error) {
        const dbRole = normalizeAppRole((data as any)?.role);
        if (dbRole) return dbRole;
      } else {
        console.log("profiles role check error:", error);
      }
    } catch (e) {
      console.log("profiles role check failed:", e);
    }

    return normalizeAppRole(await getSelectedRole());
  }, []);

  const getDriverStatus = React.useCallback(
    async (uid: string): Promise<DriverStatus | null> => {
      try {
        const { data, error } = await supabase
          .from("driver_profiles")
          .select("status")
          .eq("user_id", uid)
          .maybeSingle();

        if (error) {
          console.log("driver_profiles status check error:", error);
          return null;
        }

        return ((data as any)?.status as DriverStatus | undefined) ?? null;
      } catch (e) {
        console.log("driver profile status check failed:", e);
        return null;
      }
    },
    []
  );

  const openResetPassword = React.useCallback(() => {
    resetPasswordFlowRef.current = true;

    if (!navReady()) return;

    const cur = currentRoute();
    if (cur === "ResetPassword") return;

    navRef.current?.reset({
      index: 0,
      routes: [{ name: "ResetPassword" }],
    });
  }, [currentRoute, navReady]);


  const openDriverReferralAuth = React.useCallback(
    (code: string) => {
      if (!navReady()) return;

      resetPasswordFlowRef.current = false;

      navRef.current?.reset({
        index: 0,
        routes: [{ name: "DriverAuth", params: { ref: code } }],
      });
    },
    [navReady]
  );

  const isInSellerArea = React.useCallback((r?: keyof RootStackParamList) => {
    if (!r) return false;
    return (
      r === "SellerGate" ||
      r === "SellerOnboarding" ||
      r === "SellerDashboard" ||
      r === "SellerProducts" ||
      r === "SellerOrders"
    );
  }, []);

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
      r === "MmdAi" ||
      r === "ClientProfile" ||
      (__DEV__ ? r === "LocationPickerTest" : false) ||
      r === "MMDLocationPicker" ||
      r === "TaxiHome" ||
      r === "TaxiQuote" ||
      r === "TaxiRideTracking" ||
      r === "TaxiHistory" ||
      r === "TaxiFavorites" ||
      r === "TaxiLoyalty" ||
      r === "TaxiScheduled" ||
      r === "TaxiScheduledBook" ||
      r === "TaxiMultiStop" ||
      r === "TaxiLoyaltyRewards" ||
      r === "TaxiChat" ||
      r === "MarketplaceHome" ||
      r === "MarketplaceProductList" ||
      r === "MarketplaceProductDetails" ||
      r === "MarketplaceCart" ||
      r === "SellerGate" ||
      r === "SellerOnboarding" ||
      r === "SellerDashboard" ||
      r === "SellerProducts" ||
      r === "SellerOrders"
    );
  }, []);

  const isInDriverArea = React.useCallback((r?: keyof RootStackParamList) => {
    if (!r) return false;
    return (
      r === "DriverTabs" ||
      r === "DriverOrderDetails" ||
      r === "DriverMap" ||
      r === "DriverChat" ||
      r === "DriverTaxiChat" ||
      r === "DriverOnboarding" ||
      r === "DriverIdentityVerification" ||
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
        r === "RestaurantCommandCenter" ||
        r === "RestaurantOrders" ||
        r === "RestaurantOrderDetails" ||
        r === "RestaurantEarnings" ||
        r === "RestaurantFinancialCenter" ||
        r === "RestaurantTax" ||
        r === "RestaurantLanguage" ||
        r === "RestaurantSecurity" ||
        r === "RestaurantOrderAutomation" ||
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
          console.log("client_profiles check error:", error.message);
          return false;
        }

        const phoneOk = !!(data as any)?.phone?.trim?.();
        const addrOk = !!(data as any)?.address?.trim?.();
        const nameOk = !!(data as any)?.full_name?.trim?.();
        const avatarOk = !!(data as any)?.avatar_url?.trim?.();

        return phoneOk && addrOk && nameOk && avatarOk;
      } catch (e) {
        console.log("client profile complete check failed:", e);
        return false;
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

      const cur = currentRoute();
      const navPreviewActive =
        __DEV__ && process.env.EXPO_PUBLIC_DRIVER_NAV_PREVIEW === "1";

      if (navPreviewActive && cur === "DriverMap") {
        return;
      }

      if (cur === "ResetPassword" || resetPasswordFlowRef.current) {
        if (cur !== "ResetPassword") openResetPassword();
        return;
      }

      const { data } = await supabase.auth.getSession();
      const session = data.session ?? null;

      if (!session) {
        if (navPreviewActive && cur === "DriverMap") {
          return;
        }

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
      const accountStatus = await getAccountStatus(uid);

      if (!isAccountActive(accountStatus)) {
        const blockMessage = accountStatusBlockMessage(accountStatus);
        if (blockMessage) {
          console.log("Account blocked:", blockMessage);
        }
        await supabase.auth.signOut();
        resetTo("RoleSelect");
        return;
      }

      const role = await resolveUserRole(uid);

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
        const status = await getDriverStatus(uid);

        if (status === "suspended" || status === "disabled") {
          await supabase.auth.signOut();
          resetTo("DriverAuth");
          return;
        }

        if (status === "approved") {
          if (isInDriverArea(cur) && cur !== "DriverOnboarding") return;
          resetTo("DriverTabs");
          return;
        }

        if (
          status === "pending" ||
          status === "incomplete" ||
          status === "rejected" ||
          status === null
        ) {
          if (cur !== "DriverOnboarding") resetTo("DriverOnboarding");
          return;
        }

        resetTo("DriverOnboarding");
        return;
      }

      if (role === "restaurant") {
        const restaurantStatus = await getRestaurantStatus(uid);

        if (!isRestaurantOrderEligible(restaurantStatus)) {
          if (cur !== "RestaurantGate" && cur !== "RestaurantSetup") {
            resetTo("RestaurantGate");
          }
          return;
        }

        const ok = await isRestaurantProfileComplete(uid);

        if (!ok) {
          if (cur !== "RestaurantGate" && cur !== "RestaurantSetup") {
            resetTo("RestaurantGate");
          }
          return;
        }

        if (isInRestaurantArea(cur)) return;
        resetTo("RestaurantCommandCenter");
        return;
      }

      if (role === "seller") {
        if (isInSellerArea(cur)) return;
        resetTo("SellerGate");
        return;
      }

      if (role === "admin") {
        resetTo("RoleSelect");
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
    openResetPassword,
    isClientProfileComplete,
    isRestaurantProfileComplete,
    getAccountStatus,
    getRestaurantStatus,
    resolveUserRole,
    getDriverStatus,
    isInClientArea,
    isInDriverArea,
    isInRestaurantArea,
    isInSellerArea,
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

    const handleUrl = (url: string | null) => {
      if (!alive) return;

      const normalizedUrl = normalizeDeepLinkUrl(url);

      if (isResetPasswordUrl(normalizedUrl)) {
        console.log("RESET PASSWORD DEEP LINK RECEIVED =", normalizedUrl);
        openResetPassword();
        return;
      }

      const referralCode = extractReferralCodeFromUrl(normalizedUrl);
      if (referralCode) {
        console.log("DRIVER REFERRAL DEEP LINK RECEIVED =", referralCode);
        openDriverReferralAuth(referralCode);
      }
    };

    Linking.getInitialURL()
      .then(handleUrl)
      .catch((e) => console.log("getInitialURL error", e));

    const linkingSub = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      alive = false;
      try {
        linkingSub?.remove?.();
      } catch {}
    };
  }, [openDriverReferralAuth, openResetPassword]);

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

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!alive) return;

      if (event === "PASSWORD_RECOVERY") {
        resetPasswordFlowRef.current = true;
        openResetPassword();
        return;
      }

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
  }, [openResetPassword, scheduleSync]);

  return (
    <NavigationContainer
      ref={navRef}
      onReady={() => {
        scheduleSync();
        Linking.getInitialURL()
          .then((url) => {
            const normalizedUrl = normalizeDeepLinkUrl(url);

            if (isResetPasswordUrl(normalizedUrl)) {
              openResetPassword();
              return;
            }

            const referralCode = extractReferralCodeFromUrl(normalizedUrl);
            if (referralCode) openDriverReferralAuth(referralCode);
          })
          .catch((e) => console.log("onReady getInitialURL error", e));
      }}
      linking={linking}
    >
      <Stack.Navigator
        id="root-stack"
        initialRouteName={initialRouteName}
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />
        <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />

        <Stack.Screen
          name="DeliveryRequest"
          component={DeliveryRequestScreen}
        />

        <Stack.Screen name="ClientAuth" component={ClientAuthScreen} />
        <Stack.Screen name="DriverAuth" component={DriverAuthScreen} />
        <Stack.Screen name="RestaurantAuth" component={RestaurantAuthScreen} />

        <Stack.Screen name="ClientProfile" component={ClientProfileScreen} />
        {__DEV__ ? (
          <Stack.Screen
            name="LocationPickerTest"
            component={LocationPickerTestScreen}
            options={{ title: "Africa Location Test" }}
          />
        ) : null}

        <Stack.Screen
          name="MMDLocationPicker"
          component={MMDLocationPickerScreen}
          options={{ title: "Exact location" }}
        />

        <Stack.Screen name="RestaurantGate" component={RestaurantGateScreen} />
        <Stack.Screen
          name="RestaurantSetup"
          component={RestaurantSetupScreen}
        />
        <Stack.Screen name="RestaurantMenu" component={RestaurantMenuScreen} />

        <Stack.Screen name="SellerGate" component={SellerGateScreen} />
        <Stack.Screen name="SellerOnboarding" component={SellerOnboardingScreen} />
        <Stack.Screen name="SellerDashboard" component={SellerDashboardScreen} />
        <Stack.Screen name="SellerProducts" component={SellerProductsScreen} />
        <Stack.Screen name="SellerOrders" component={SellerOrdersScreen} />

        <Stack.Screen name="MarketplaceHome" component={MarketplaceHomeScreen} />
        <Stack.Screen name="MarketplaceProductList" component={MarketplaceProductListScreen} />
        <Stack.Screen name="MarketplaceProductDetails" component={MarketplaceProductDetailsScreen} />
        <Stack.Screen name="MarketplaceCart" component={MarketplaceCartScreen} />

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
        <Stack.Screen name="MmdAi" component={MmdAiScreen} />
        <Stack.Screen name="ClientChat" component={ClientChatScreen} />

        <Stack.Screen name="TaxiHome" component={TaxiHomeScreen} />
        <Stack.Screen name="TaxiQuote" component={TaxiQuoteScreen} />
        <Stack.Screen
          name="TaxiRideTracking"
          component={TaxiRideTrackingScreen}
        />
        <Stack.Screen name="TaxiHistory" component={TaxiHistoryScreen} />
        <Stack.Screen name="TaxiFavorites" component={TaxiFavoritesScreen} />
        <Stack.Screen name="TaxiLoyalty" component={TaxiLoyaltyScreen} />
        <Stack.Screen name="TaxiScheduled" component={TaxiScheduledScreen} />
        <Stack.Screen name="TaxiScheduledBook" component={TaxiScheduledBookScreen} />
        <Stack.Screen name="TaxiMultiStop" component={TaxiMultiStopScreen} />
        <Stack.Screen name="TaxiLoyaltyRewards" component={TaxiLoyaltyRewardsScreen} />
        <Stack.Screen name="TaxiChat" component={TaxiChatScreen} />

        <Stack.Screen name="DriverTabs" component={DriverTabs} />
        <Stack.Screen
          name="DriverOrderDetails"
          component={DriverOrderDetailsScreen}
        />
        <Stack.Screen
          name="DriverMap"
          component={DriverMapScreen}
          initialParams={
            __DEV__ && process.env.EXPO_PUBLIC_DRIVER_NAV_PREVIEW === "1"
              ? { orderId: "__preview__" }
              : undefined
          }
        />
        <Stack.Screen name="DriverChat" component={DriverChatScreen} />
        <Stack.Screen name="DriverTaxiChat" component={DriverTaxiChatScreen} />
        <Stack.Screen
          name="DriverOnboarding"
          component={DriverOnboardingScreen}
        />
        <Stack.Screen
          name="DriverIdentityVerification"
          component={DriverIdentityVerificationScreen}
          options={{ title: "Vérification d'identité" }}
        />

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
          name="DriverPrivacyScreen"
          component={DriverPrivacyScreen}
        />
        <Stack.Screen
          name="DriverAboutScreen"
          component={DriverAboutScreen}
        />
        <Stack.Screen
          name="DriverSecurity"
          component={DriverSecurityScreen}
        />
        <Stack.Screen
          name="DriverLanguage"
          component={DriverLanguageScreen}
        />

        <Stack.Screen name="DriverTax" component={DriverTaxScreen} />
        <Stack.Screen name="DriverW9" component={DriverW9Screen} />

        <Stack.Screen
          name="DriverRevenueDetails"
          component={DriverRevenueDetailsScreen}
        />
        <Stack.Screen
          name="DriverRevenueHistory"
          component={DriverRevenueHistoryScreen}
        />
        <Stack.Screen
          name="DriverServices"
          component={DriverServicesScreen}
          options={{ title: "Mes services" }}
        />
        <Stack.Screen
          name="DriverVehicles"
          component={DriverVehiclesScreen}
          options={{ title: "Mes véhicules" }}
        />
        <Stack.Screen
          name="DriverVehicle"
          component={DriverVehicleScreen}
          options={{ title: "Mon véhicule" }}
        />
        <Stack.Screen name="DriverWallet" component={DriverWalletScreen} />
        <Stack.Screen name="DriverBenefits" component={DriverBenefitsScreen} />

        <Stack.Screen name="RestaurantHome" component={RestaurantHomeScreen} />
        <Stack.Screen
          name="RestaurantCommandCenter"
          component={RestaurantCommandCenterScreen}
        />
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
        <Stack.Screen
          name="RestaurantFinancialCenter"
          component={RestaurantFinancialCenterScreen}
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
        <Stack.Screen
          name="RestaurantOrderAutomation"
          component={RestaurantOrderAutomationScreen}
          options={{ title: "Commandes & impression" }}
        />
        <Stack.Screen name="RestaurantChat" component={RestaurantChatScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
