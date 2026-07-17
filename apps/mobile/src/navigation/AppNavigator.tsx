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

import { HomeScreen } from "../screens/HomeScreen";
import { RoleSelectScreen } from "../screens/RoleSelectScreen";
import ResetPasswordScreen from "../screens/ResetPasswordScreen";
import { ClientAuthScreen } from "../screens/ClientAuthScreen";
import { DriverAuthScreen } from "../screens/DriverAuthScreen";
import { RestaurantAuthScreen } from "../screens/RestaurantAuthScreen";

import type { MmdLocationPickerResult } from "../lib/mmdLocationDisplay";
import * as Notifications from "expo-notifications";
import {
  extractDriverMissionPushPayload,
  isDriverMissionPushType,
  navigateToDriverMission,
} from "../lib/driverMissionPush";
import {
  navigateFromCommunicationPush,
} from "../lib/communicationPushRouting";
import { syncAppBadgeFromServer } from "../lib/chatApi";
import { notifyDriverMissionPushReceived } from "../lib/driverMissionPushEvents";
import {
  extractTaxiPushPayload,
  isClientTaxiPushType,
  notifyTaxiOfferPushReceived,
} from "../lib/taxiPushEvents";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";

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
  SellerOnboarding: { mode?: "edit" } | undefined;
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
    orderId?: string;
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

  LoyaltyHub: { role?: "client" | "driver" } | undefined;

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
    stops?: { address?: string; lat?: number; lng?: number }[];
    locationPickerResult?: MmdLocationPickerResult;
    preferElectricOrHybrid?: boolean;
    clientPreferences?: Record<string, boolean>;
    ambiancePreference?: "quiet" | "music" | "conversation" | "none";
    tripMode?: "one_way" | "round_trip";
    returnMode?: "immediate" | "wait" | "scheduled";
    returnWaitMinutes?: number;
    returnScheduledAt?: string;
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
    function handleDriverMissionPush(data: unknown) {
      const payload = extractDriverMissionPushPayload(data);
      if (!isDriverMissionPushType(payload.type)) return;

      notifyDriverMissionPushReceived(payload.type);
      if (payload.type === "taxi_offer_dispatch") {
        notifyTaxiOfferPushReceived();
      }

      if (navReady()) {
        navigateToDriverMission(navRef.current, payload);
      }
    }

    function handleClientTaxiPush(data: unknown) {
      const payload = extractTaxiPushPayload(data);
      if (!isClientTaxiPushType(payload.type)) return;
      if (payload.type === "driver_arrived" && !payload.taxiRideId) return;
      if (payload.taxiRideId && navReady()) {
        navRef.current?.navigate("TaxiRideTracking", {
          rideId: payload.taxiRideId,
        });
      }
    }

    function handleNotificationData(data: unknown) {
      if (navigateFromCommunicationPush(navRef.current as any, data)) {
        void syncAppBadgeFromServer();
        return;
      }
      handleDriverMissionPush(data);
      handleClientTaxiPush(data);
      void syncAppBadgeFromServer();
    }

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      handleNotificationData(notification.request.content.data);
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationData(response.notification.request.content.data);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationData(response.notification.request.content.data);
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
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
      r === "LoyaltyHub" ||
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
      r === "LoyaltyHub" ||
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
      r === "DriverBenefits" ||
      r === "DriverServices" ||
      r === "DriverVehicles" ||
      r === "DriverVehicle"
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

    let profileChannel: ReturnType<typeof supabase.channel> | null = null;
    let profileUserId: string | null = null;

    const subscribeDriverProfile = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const uid = data.session?.user?.id ?? null;
        if (!alive || !uid) return;
        if (profileUserId === uid && profileChannel) return;

        await unsubscribeSupabaseChannel(profileChannel);
        profileChannel = null;
        profileUserId = uid;

        profileChannel = subscribePostgresChannel(
          `driver-profile-status-${uid}`,
          [
            {
              event: "UPDATE",
              table: "driver_profiles",
              filter: `user_id=eq.${uid}`,
              callback: () => {
                if (alive) scheduleSync();
              },
            },
            {
              event: "*",
              table: "driver_vehicles",
              filter: `driver_user_id=eq.${uid}`,
              callback: () => {
                if (alive) scheduleSync();
              },
            },
          ],
        );
      } catch (e) {
        console.log("driver profile realtime subscribe error:", e);
      }
    };

    void subscribeDriverProfile();

    return () => {
      alive = false;
      try {
        sub?.subscription?.unsubscribe?.();
      } catch {}
      try {
        appStateSub?.remove?.();
      } catch {}
      void unsubscribeSupabaseChannel(profileChannel);
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
          getComponent={() =>
            require("../screens/DeliveryRequestScreen").default
          }
        />

        <Stack.Screen name="ClientAuth" component={ClientAuthScreen} />
        <Stack.Screen name="DriverAuth" component={DriverAuthScreen} />
        <Stack.Screen name="RestaurantAuth" component={RestaurantAuthScreen} />

        <Stack.Screen
          name="ClientProfile"
          getComponent={() =>
            require("../screens/ClientProfileScreen").ClientProfileScreen
          }
        />
        {__DEV__ ? (
          <Stack.Screen
            name="LocationPickerTest"
            getComponent={() =>
              require("../screens/LocationPickerTestScreen").default
            }
            options={{ title: "Africa Location Test" }}
          />
        ) : null}

        <Stack.Screen
          name="MMDLocationPicker"
          getComponent={() =>
            require("../screens/MMDLocationPickerScreen").default
          }
          options={{ title: "Exact location" }}
        />

        <Stack.Screen
          name="RestaurantGate"
          getComponent={() =>
            require("../screens/restaurant/RestaurantGateScreen").default
          }
        />
        <Stack.Screen
          name="RestaurantSetup"
          getComponent={() =>
            require("../screens/restaurant/RestaurantSetupScreen").default
          }
        />
        <Stack.Screen
          name="RestaurantMenu"
          getComponent={() =>
            require("../screens/restaurant/RestaurantMenuScreen").default
          }
        />

        <Stack.Screen
          name="SellerGate"
          getComponent={() =>
            require("../screens/seller/SellerGateScreen").default
          }
        />
        <Stack.Screen
          name="SellerOnboarding"
          getComponent={() =>
            require("../screens/seller/SellerOnboardingScreen").default
          }
        />
        <Stack.Screen
          name="SellerDashboard"
          getComponent={() =>
            require("../screens/seller/SellerDashboardScreen").default
          }
        />
        <Stack.Screen
          name="SellerProducts"
          getComponent={() =>
            require("../screens/seller/SellerProductsScreen").default
          }
        />
        <Stack.Screen
          name="SellerOrders"
          getComponent={() =>
            require("../screens/seller/SellerOrdersScreen").default
          }
        />

        <Stack.Screen
          name="MarketplaceHome"
          getComponent={() =>
            require("../screens/marketplace/MarketplaceHomeScreen").default
          }
        />
        <Stack.Screen
          name="MarketplaceProductList"
          getComponent={() =>
            require("../screens/marketplace/MarketplaceProductListScreen")
              .default
          }
        />
        <Stack.Screen
          name="MarketplaceProductDetails"
          getComponent={() =>
            require("../screens/marketplace/MarketplaceProductDetailsScreen")
              .default
          }
        />
        <Stack.Screen
          name="MarketplaceCart"
          getComponent={() =>
            require("../screens/marketplace/MarketplaceCartScreen").default
          }
        />

        <Stack.Screen
          name="ClientHome"
          getComponent={() =>
            require("../screens/ClientHomeScreen").ClientHomeScreen
          }
        />
        <Stack.Screen
          name="ClientNewOrder"
          getComponent={() =>
            require("../screens/ClientNewOrderScreen").ClientNewOrderScreen
          }
        />
        <Stack.Screen
          name="ClientRestaurantList"
          getComponent={() =>
            require("../screens/ClientRestaurantListScreen")
              .ClientRestaurantListScreen
          }
        />
        <Stack.Screen
          name="ClientRestaurantMenu"
          getComponent={() =>
            require("../screens/ClientRestaurantMenuScreen")
              .ClientRestaurantMenuScreen
          }
        />
        <Stack.Screen
          name="ClientOrderDetails"
          getComponent={() =>
            require("../screens/ClientOrderDetailsScreen")
              .ClientOrderDetailsScreen
          }
        />
        <Stack.Screen
          name="ClientDeliveryRequestDetails"
          getComponent={() =>
            require("../screens/ClientDeliveryRequestDetailsScreen")
              .ClientDeliveryRequestDetailsScreen
          }
        />
        <Stack.Screen
          name="ClientInbox"
          getComponent={() =>
            require("../screens/ClientInboxScreen").ClientInboxScreen
          }
        />
        <Stack.Screen
          name="MmdAi"
          getComponent={() => require("../screens/MmdAiScreen").default}
        />
        <Stack.Screen
          name="ClientChat"
          getComponent={() =>
            require("../screens/ClientChatScreen").ClientChatScreen
          }
        />

        <Stack.Screen
          name="TaxiHome"
          getComponent={() => require("../screens/taxi/TaxiHomeScreen").default}
        />
        <Stack.Screen
          name="TaxiQuote"
          getComponent={() =>
            require("../screens/taxi/TaxiQuoteScreen").default
          }
        />
        <Stack.Screen
          name="TaxiRideTracking"
          getComponent={() =>
            require("../screens/taxi/TaxiRideTrackingScreen").default
          }
        />
        <Stack.Screen
          name="TaxiHistory"
          getComponent={() =>
            require("../screens/taxi/TaxiHistoryScreen").default
          }
        />
        <Stack.Screen
          name="TaxiFavorites"
          getComponent={() =>
            require("../screens/taxi/TaxiFavoritesScreen").default
          }
        />
        <Stack.Screen
          name="TaxiLoyalty"
          getComponent={() =>
            require("../screens/taxi/TaxiLoyaltyScreen").default
          }
        />
        <Stack.Screen
          name="TaxiScheduled"
          getComponent={() =>
            require("../screens/taxi/TaxiScheduledScreen").default
          }
        />
        <Stack.Screen
          name="TaxiScheduledBook"
          getComponent={() =>
            require("../screens/taxi/TaxiScheduledBookScreen").default
          }
        />
        <Stack.Screen
          name="TaxiMultiStop"
          getComponent={() =>
            require("../screens/taxi/TaxiMultiStopScreen").default
          }
        />
        <Stack.Screen
          name="TaxiLoyaltyRewards"
          getComponent={() =>
            require("../screens/taxi/TaxiLoyaltyRewardsScreen").default
          }
        />
        <Stack.Screen
          name="TaxiChat"
          getComponent={() => require("../screens/taxi/TaxiChatScreen").default}
        />

        <Stack.Screen
          name="LoyaltyHub"
          getComponent={() => require("../screens/LoyaltyScreen").default}
        />

        <Stack.Screen
          name="DriverTabs"
          getComponent={() => require("./DriverTabs").DriverTabs}
        />
        <Stack.Screen
          name="DriverOrderDetails"
          getComponent={() =>
            require("../screens/DriverOrderDetailsScreen")
              .DriverOrderDetailsScreen
          }
        />
        <Stack.Screen
          name="DriverMap"
          getComponent={() => require("../screens/DriverMapScreen").default}
          initialParams={
            __DEV__ && process.env.EXPO_PUBLIC_DRIVER_NAV_PREVIEW === "1"
              ? { orderId: "__preview__" }
              : undefined
          }
        />
        <Stack.Screen
          name="DriverChat"
          getComponent={() =>
            require("../screens/DriverChatScreen").DriverChatScreen
          }
        />
        <Stack.Screen
          name="DriverTaxiChat"
          getComponent={() =>
            require("../screens/taxi/DriverTaxiChatScreen").default
          }
        />
        <Stack.Screen
          name="DriverOnboarding"
          getComponent={() =>
            require("../screens/DriverOnboardingScreen").DriverOnboardingScreen
          }
        />
        <Stack.Screen
          name="DriverIdentityVerification"
          getComponent={() =>
            require("../screens/DriverIdentityVerificationScreen")
              .DriverIdentityVerificationScreen
          }
          options={{ title: "Vérification d'identité" }}
        />

        <Stack.Screen
          name="DriverProfile"
          getComponent={() =>
            require("../screens/DriverProfileScreen").DriverProfileScreen
          }
        />
        <Stack.Screen
          name="DriverReferrals"
          getComponent={() =>
            require("../screens/DriverReferralsScreen").DriverReferralsScreen
          }
        />
        <Stack.Screen
          name="DriverOpportunities"
          getComponent={() =>
            require("../screens/DriverOpportunitiesScreen")
              .DriverOpportunitiesScreen
          }
        />
        <Stack.Screen
          name="DriverAccount"
          getComponent={() =>
            require("../screens/DriverAccountScreen").DriverAccountScreen
          }
        />
        <Stack.Screen
          name="DriverHelp"
          getComponent={() =>
            require("../screens/DriverHelpScreen").DriverHelpScreen
          }
        />
        <Stack.Screen
          name="DriverWorkAccount"
          getComponent={() =>
            require("../screens/DriverWorkAccountScreen")
              .DriverWorkAccountScreen
          }
        />
        <Stack.Screen
          name="DriverPrivacyScreen"
          getComponent={() =>
            require("../screens/DriverPrivacyScreen").default
          }
        />
        <Stack.Screen
          name="DriverAboutScreen"
          getComponent={() => require("../screens/DriverAboutScreen").default}
        />
        <Stack.Screen
          name="DriverSecurity"
          getComponent={() =>
            require("../screens/DriverSecurityScreen").DriverSecurityScreen
          }
        />
        <Stack.Screen
          name="DriverLanguage"
          getComponent={() =>
            require("../screens/DriverLanguageScreen").DriverLanguageScreen
          }
        />

        <Stack.Screen
          name="DriverTax"
          getComponent={() => require("../screens/DriverTaxScreen").default}
        />
        <Stack.Screen
          name="DriverW9"
          getComponent={() => require("../screens/DriverW9Screen").default}
        />

        <Stack.Screen
          name="DriverRevenueDetails"
          getComponent={() =>
            require("../screens/DriverRevenueDetailsScreen")
              .DriverRevenueDetailsScreen
          }
        />
        <Stack.Screen
          name="DriverRevenueHistory"
          getComponent={() =>
            require("../screens/DriverRevenueHistoryScreen")
              .DriverRevenueHistoryScreen
          }
        />
        <Stack.Screen
          name="DriverServices"
          getComponent={() =>
            require("../screens/driver/DriverServicesScreen")
              .DriverServicesScreen
          }
          options={{ title: "Mes services" }}
        />
        <Stack.Screen
          name="DriverVehicles"
          getComponent={() =>
            require("../screens/driver/DriverVehiclesScreen")
              .DriverVehiclesScreen
          }
          options={{ title: "Mes véhicules" }}
        />
        <Stack.Screen
          name="DriverVehicle"
          getComponent={() =>
            require("../screens/driver/DriverVehicleScreen").DriverVehicleScreen
          }
          options={{ title: "Mon véhicule" }}
        />
        <Stack.Screen
          name="DriverWallet"
          getComponent={() =>
            require("../screens/DriverWalletScreen").DriverWalletScreen
          }
        />
        <Stack.Screen
          name="DriverBenefits"
          getComponent={() =>
            require("../screens/DriverBenefitsScreen").DriverBenefitsScreen
          }
        />

        <Stack.Screen
          name="RestaurantHome"
          getComponent={() =>
            require("../screens/RestaurantHomeScreen").RestaurantHomeScreen
          }
        />
        <Stack.Screen
          name="RestaurantCommandCenter"
          getComponent={() =>
            require("../screens/restaurant/RestaurantCommandCenterScreen")
              .default
          }
        />
        <Stack.Screen
          name="RestaurantOrders"
          getComponent={() =>
            require("../screens/RestaurantOrdersScreen").RestaurantOrdersScreen
          }
        />
        <Stack.Screen
          name="RestaurantOrderDetails"
          getComponent={() =>
            require("../screens/RestaurantOrderDetailsScreen")
              .RestaurantOrderDetailsScreen
          }
        />
        <Stack.Screen
          name="RestaurantEarnings"
          getComponent={() =>
            require("../screens/RestaurantEarningsScreen")
              .RestaurantEarningsScreen
          }
        />
        <Stack.Screen
          name="RestaurantFinancialCenter"
          getComponent={() =>
            require("../screens/RestaurantFinancialCenterScreen").default
          }
        />
        <Stack.Screen
          name="RestaurantTax"
          getComponent={() =>
            require("../screens/RestaurantTaxScreen").default
          }
        />
        <Stack.Screen
          name="RestaurantLanguage"
          getComponent={() =>
            require("../screens/RestaurantLanguageScreen")
              .RestaurantLanguageScreen
          }
        />
        <Stack.Screen
          name="RestaurantSecurity"
          getComponent={() =>
            require("../screens/RestaurantSecurityScreen")
              .RestaurantSecurityScreen
          }
        />
        <Stack.Screen
          name="RestaurantOrderAutomation"
          getComponent={() =>
            require("../screens/restaurant/RestaurantOrderAutomationScreen")
              .RestaurantOrderAutomationScreen
          }
          options={{ title: "Commandes & impression" }}
        />
        <Stack.Screen
          name="RestaurantChat"
          getComponent={() =>
            require("../screens/RestaurantChatScreen").RestaurantChatScreen
          }
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
