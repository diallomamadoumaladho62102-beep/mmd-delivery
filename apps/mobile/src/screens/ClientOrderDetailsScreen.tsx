// apps/mobile/src/screens/ClientOrderDetailsScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  TextInput,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { supabase } from "../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";
import { mmdAudio } from "../lib/mmdAudio";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { openStripeCheckout } from "../lib/stripe";
import { payOrderWithPaymentSheet } from "../utils/stripe";
import { confirmOrderPaid } from "../../lib/payments";
import { PaymentMethodPicker } from "../components/PaymentMethodPicker";
import {
  inferCountryCode,
  type PaymentMethodOption,
} from "../lib/paymentMethodsApi";
import {
  loadLocalPaymentMethods,
  shouldOfferLocalMobileMoney,
  startLocalPaymentForMethod,
} from "../lib/localPayments";
import { getApiBaseUrl } from "../../lib/apiBase";
import { useTranslation } from "react-i18next";
import {
  ensureMapboxTokenApplied,
  getMapStyleStreets,
} from "../lib/mapboxConfig";
import Mapbox from "@rnmapbox/maps";

// ✅ Live driver hook
import { useLiveDriverLocation } from "../hooks/useLiveDriverLocation";
import { startMaskedCall } from "../lib/maskedCall";

// ✅ API URL: fallback robuste via expoConfig.extra
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE_URL;


function cleanApiUrl() {
  const raw = String(API_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function isValidCoordinate(latValue: unknown, lngValue: unknown) {
  const lat = Number(latValue);
  const lng = Number(lngValue);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function normalizeAvatarUrl(value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;

  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(clean);
  return data?.publicUrl ?? null;
}

function getInitials(name: string | null | undefined, fallback = "U") {
  const clean = String(name ?? "").trim();
  if (!clean) return fallback;

  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || fallback;
}

type Route = RouteProp<RootStackParamList, "ClientOrderDetails">;
type Nav = NativeStackNavigationProp<RootStackParamList, "ClientOrderDetails">;

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type Order = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  grand_total?: number | null;
  delivery_fee: number | null;
  dropoff_code: string | null;
  payment_status?: string | null;
  currency?: string | null;
  driver_id?: string | null;
  restaurant_id?: string | null;
  restaurant_user_id?: string | null;
  restaurant_name?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  tip_cents?: number | null;
  client_id?: string | null;
  client_user_id?: string | null;
  user_id?: string | null;
};

type CreateCheckoutResponse = {
  url?: string;
  session_id?: string;
  error?: string;
};

type CancelOrderResponse = {
  ok?: boolean;
  cancelled?: boolean;
  by?: string;
  refund?: "FULL" | "NONE" | string;
  error?: string;
};

type CommunicationTarget = "restaurant" | "driver" | "admin";

const AVATARS_BUCKET = "avatars";

type PublicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type RestaurantPublicProfile = {
  user_id: string;
  restaurant_name: string | null;
  avatar_url?: string | null;
};

// =========================
// ✅ Helpers
// =========================

async function readErrorBody(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as any;
    if (typeof j?.error === "string") return j.error;
    return JSON.stringify(j);
  } catch {
    try {
      return await res.text();
    } catch {
      return "";
    }
  }
}

const TIP_PRESETS = [0, 2, 5, 10] as const;
const TIP_MAX_DOLLARS = 500;

function sanitizeMoneyInput(raw: string) {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  const parts = cleaned.split(".");
  if (parts.length <= 1) return cleaned;
  return `${parts[0]}.${parts.slice(1).join("").slice(0, 2)}`;
}

function parseMoneyToDollars(raw: string): number {
  const s = sanitizeMoneyInput(raw);
  if (!s) return 0;
  const n = Number(s);
  if (!Number.isFinite(n) || Number.isNaN(n)) return 0;
  return Math.min(TIP_MAX_DOLLARS, Math.max(0, n));
}

function money(v: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return `$${v.toFixed(2)}`;
}

function compactId(uuid: string) {
  return (uuid || "").slice(0, 8);
}

function formatCompactDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${date} • ${time}`;
}

function formatCodeSpaced(code: string | null) {
  const s = String(code || "").replace(/\s+/g, "");
  if (!s) return "— — — — — —";
  if (s.length <= 3) return s;
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}

function normalizePaymentStatus(v?: string | null) {
  return String(v ?? "unpaid").trim().toLowerCase();
}

function statusMeta(status: OrderStatus, translate: (key: string, fallback: string) => string) {
  switch (status) {
    case "delivered":
      return {
        title: translate("orders.status.delivered", "Delivered") + " ✅",
        pillBg: "rgba(34,197,94,0.14)",
        pillBorder: "rgba(34,197,94,0.32)",
        pillText: "#86EFAC",
      };
    case "dispatched":
      return {
        title: translate("orders.status.dispatched", "On the way") + " 🚚",
        pillBg: "rgba(59,130,246,0.14)",
        pillBorder: "rgba(59,130,246,0.30)",
        pillText: "#93C5FD",
      };
    case "ready":
      return {
        title: translate("orders.status.ready", "Ready") + " ✅",
        pillBg: "rgba(251,191,36,0.12)",
        pillBorder: "rgba(251,191,36,0.28)",
        pillText: "#FBBF24",
      };
    case "prepared":
      return {
        title: translate("orders.status.prepared", "Preparing") + " 🍳",
        pillBg: "rgba(148,163,184,0.10)",
        pillBorder: "rgba(148,163,184,0.20)",
        pillText: "#CBD5E1",
      };
    case "accepted":
      return {
        title: translate("orders.status.acceptedRestaurant", "Accepted") + " ✅",
        pillBg: "rgba(148,163,184,0.10)",
        pillBorder: "rgba(148,163,184,0.20)",
        pillText: "#CBD5E1",
      };
    case "pending":
      return {
        title: translate("orders.status.pendingRestaurant", "Pending") + " ⏳",
        pillBg: "rgba(148,163,184,0.10)",
        pillBorder: "rgba(148,163,184,0.20)",
        pillText: "#CBD5E1",
      };
    case "canceled":
      return {
        title: translate("orders.status.canceled", "Canceled") + " ✖",
        pillBg: "rgba(248,113,113,0.14)",
        pillBorder: "rgba(248,113,113,0.30)",
        pillText: "#FCA5A5",
      };
    default:
      return {
        title: String(status),
        pillBg: "rgba(148,163,184,0.10)",
        pillBorder: "rgba(148,163,184,0.20)",
        pillText: "#CBD5E1",
      };
  }
}

function statusProgress(status: OrderStatus) {
  switch (status) {
    case "pending":
      return 0.15;
    case "accepted":
      return 0.3;
    case "prepared":
      return 0.5;
    case "ready":
      return 0.65;
    case "dispatched":
      return 0.85;
    case "delivered":
      return 1;
    case "canceled":
      return 0.1;
    default:
      return 0.25;
  }
}

function isFinalStatus(status: OrderStatus) {
  return status === "delivered" || status === "canceled";
}
type LatLng = {
  latitude: number;
  longitude: number;
};

function toMapboxCoord(coord: LatLng): [number, number] {
  return [coord.longitude, coord.latitude];
}

function makeLineFeature(coords: LatLng[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: coords.map(toMapboxCoord),
    },
  };
}

function getCameraForCoords(coords: LatLng[]) {
  const fallback = {
    centerCoordinate: [-73.949997, 40.650002] as [number, number],
    zoomLevel: 11,
  };

  if (coords.length === 0) return fallback;

  if (coords.length === 1) {
    return {
      centerCoordinate: toMapboxCoord(coords[0]),
      zoomLevel: 14,
    };
  }

  const lats = coords.map((c) => c.latitude);
  const lngs = coords.map((c) => c.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const delta = Math.max(maxLat - minLat, maxLng - minLng, 0.01);
  const zoomLevel = Math.max(10, Math.min(15, Math.log2(360 / (delta * 3.2))));

  return {
    centerCoordinate: [centerLng, centerLat] as [number, number],
    zoomLevel,
  };
}


export function ClientOrderDetailsScreen() {
  const { t, i18n } = useTranslation();
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { orderId } = route.params;

  useEffect(() => {
    ensureMapboxTokenApplied();
  }, []);

  const ts = useCallback(
    (key: string, fallback: string, options?: Record<string, any>) =>
      String(t(key, { defaultValue: fallback, ...(options || {}) })),
    [t, i18n.language]
  );

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [verifyingPay, setVerifyingPay] = useState(false);
  const [paymentPending, setPaymentPending] = useState(false);
  const [paymentPickerVisible, setPaymentPickerVisible] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [calling, setCalling] = useState<CommunicationTarget | null>(null);
  const [driverProfile, setDriverProfile] = useState<PublicProfile | null>(null);
  const [restaurantProfile, setRestaurantProfile] =
    useState<RestaurantPublicProfile | null>(null);

  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [tipDollars, setTipDollars] = useState<number>(0);
  const [tipCustom, setTipCustom] = useState<string>("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);

  const [codeCopied, setCodeCopied] = useState(false);

  const isMountedRef = useRef(true);
  const prevOrderStatusRef = useRef<string | null>(null);
  const backgroundPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const didFitRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (backgroundPollTimeoutRef.current) {
        clearTimeout(backgroundPollTimeoutRef.current);
        backgroundPollTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!API_URL) {
      console.warn("EXPO_PUBLIC_API_URL is missing.");
    }
  }, []);


  const loadParticipantProfiles = useCallback(
    async (nextOrder: Order) => {
      const nextDriverId = String(nextOrder.driver_id ?? "").trim();
      const nextRestaurantId = String(
        nextOrder.restaurant_id ?? nextOrder.restaurant_user_id ?? ""
      ).trim();

      const fallbackRestaurantName = String(nextOrder.restaurant_name ?? "").trim();

      try {
        const [driverRes, restaurantRes, restaurantAccountRes] = await Promise.all([
          nextDriverId
            ? supabase
                .from("profiles")
                .select("id, full_name, avatar_url")
                .eq("id", nextDriverId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),

          nextRestaurantId
            ? supabase
                .from("restaurant_profiles")
                .select("user_id, restaurant_name")
                .eq("user_id", nextRestaurantId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),

          nextRestaurantId
            ? supabase
                .from("profiles")
                .select("id, full_name, avatar_url")
                .eq("id", nextRestaurantId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null } as any),
        ]);

        if (driverRes.error) {
          console.log("ClientOrderDetails driver profile error:", driverRes.error);
        }

        if (restaurantRes.error) {
          console.log("ClientOrderDetails restaurant profile error:", restaurantRes.error);
        }

        if (restaurantAccountRes.error) {
          console.log(
            "ClientOrderDetails restaurant account profile error:",
            restaurantAccountRes.error
          );
        }

        if (!isMountedRef.current) return;

        const driverRow = driverRes.data as PublicProfile | null;
        const restaurantRow = restaurantRes.data as
          | { user_id: string; restaurant_name: string | null }
          | null;
        const restaurantAccount = restaurantAccountRes.data as PublicProfile | null;

        setDriverProfile(driverRow ?? null);

        if (nextRestaurantId || fallbackRestaurantName) {
          setRestaurantProfile({
            user_id: nextRestaurantId,
            restaurant_name:
              restaurantRow?.restaurant_name ??
              fallbackRestaurantName ??
              restaurantAccount?.full_name ??
              null,
            avatar_url: restaurantAccount?.avatar_url ?? null,
          });
        } else {
          setRestaurantProfile(null);
        }
      } catch (e) {
        console.log("ClientOrderDetails participant profiles error:", e);
        if (!isMountedRef.current) return;
        setDriverProfile(null);
        setRestaurantProfile(
          nextOrder.restaurant_name
            ? {
                user_id: String(
                  nextOrder.restaurant_id ?? nextOrder.restaurant_user_id ?? ""
                ),
                restaurant_name: nextOrder.restaurant_name,
                avatar_url: null,
              }
            : null
        );
      }
    },
    []
  );

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      const uid = user?.id ?? null;

      if (!uid) {
        throw new Error(ts("common.mustBeLoggedIn", "You must be logged in."));
      }

      const { data, error } = await supabase
        .from("orders")
        .select(
          [
            "id",
            "status",
            "created_at",
            "pickup_address",
            "dropoff_address",
            "distance_miles",
            "total",
            "grand_total",
            "delivery_fee",
            "dropoff_code",
            "payment_status",
            "currency",
            "driver_id",
            "restaurant_id",
            "restaurant_user_id",
            "restaurant_name",
            "pickup_lat",
            "pickup_lng",
            "dropoff_lat",
            "dropoff_lng",
            "tip_cents",
            "client_id",
            "client_user_id",
            "user_id",
          ].join(",")
        )
        .eq("id", orderId)
        .single();

      if (error) throw error;

      const nextOrder = data as unknown as Order;

      const ownerIds = [
        nextOrder.client_id,
        nextOrder.client_user_id,
        nextOrder.user_id,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean);

      if (ownerIds.length > 0 && !ownerIds.includes(uid)) {
        throw new Error(
          ts("client.orderDetails.notOwnerError", "You are not logged in as the order owner.")
        );
      }

      await loadParticipantProfiles(nextOrder);

      if (isMountedRef.current) {
        const prevStatus = prevOrderStatusRef.current;
        const nextStatus = String(nextOrder.status ?? "").trim().toLowerCase();

        if (prevStatus && prevStatus !== nextStatus) {
          mmdAudio.playForOrderStatus(nextStatus);
        }

        prevOrderStatusRef.current = nextStatus || null;
        setOrder(nextOrder);

        if (normalizePaymentStatus(nextOrder.payment_status) === "paid") {
          setPaymentPending(false);
        }

        didFitRef.current = false;
      }
    } catch (e: any) {
      if (isMountedRef.current) {
        setErrorMsg(e?.message ?? ts("client.orderDetails.errors.loadOrder", "Unable to load the order."));
        setOrder(null);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, [orderId, ts, loadParticipantProfiles]);

  const fetchPaymentStatusOnly = useCallback(async () => {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) throw userError;

    const uid = user?.id ?? null;

    if (!uid) {
      throw new Error("Not authenticated");
    }

    const { data, error } = await supabase
      .from("orders")
      .select("payment_status, paid_at, client_id, client_user_id, user_id")
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      throw new Error("Order not found");
    }

    const ownerIds = [
      (data as any).client_id,
      (data as any).client_user_id,
      (data as any).user_id,
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);

    if (ownerIds.length > 0 && !ownerIds.includes(uid)) {
      throw new Error("Not allowed");
    }

    return normalizePaymentStatus((data as any)?.payment_status);
  }, [orderId]);

  useEffect(() => {
    if (!orderId) return;
    fetchOrder();
  }, [orderId, fetchOrder]);

  useFocusEffect(
    useCallback(() => {
      if (orderId) {
        fetchOrder();
      }
    }, [orderId, fetchOrder])
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active" && orderId) {
        fetchOrder();
      }
    });
    return () => sub.remove();
  }, [orderId, fetchOrder]);

  useEffect(() => {
    if (!orderId) return;

    const channel = subscribePostgresChannel(`client-order-detail:${orderId}`, [
      {
        event: "*",
        table: "orders",
        filter: `id=eq.${orderId}`,
        callback: () => {
          void fetchOrder();
        },
      },
    ]);

    return () => {
      void unsubscribeSupabaseChannel(channel);
    };
  }, [orderId, fetchOrder]);

  const setTipPreset = useCallback((v: number) => {
    setTipDollars(v);
    setTipCustom(v === 0 ? "" : String(v));
  }, []);

  const tipSelectedPreset = useMemo(() => {
    const typed = parseMoneyToDollars(tipCustom);
    const match = TIP_PRESETS.find((p) => p === typed);
    return match ?? null;
  }, [tipCustom]);

  useEffect(() => {
    (async () => {
      if (!order?.id) return;
      if (order.status !== "delivered") return;

      try {
        const { data: s } = await supabase.auth.getSession();
        const uid = s.session?.user?.id;
        if (!uid) return;

        const { data } = await supabase
          .from("order_ratings")
          .select("order_id")
          .eq("order_id", order.id)
          .eq("rater_id", uid)
          .maybeSingle();

        if (isMountedRef.current) setAlreadyRated(!!data);

        const cents = Number(order.tip_cents ?? 0);
        if (cents > 0 && isMountedRef.current) {
          const dollars = cents / 100;
          setTipDollars(dollars);
          setTipCustom(dollars % 1 === 0 ? String(dollars.toFixed(0)) : String(dollars.toFixed(2)));
        }
      } catch (e) {
        console.warn("load alreadyRated/tip error:", (e as any)?.message ?? e);
      }
    })();
  }, [order?.id, order?.status, order?.tip_cents]);

  const scheduleBackgroundPaymentRefresh = useCallback(() => {
    if (backgroundPollTimeoutRef.current) {
      clearTimeout(backgroundPollTimeoutRef.current);
      backgroundPollTimeoutRef.current = null;
    }

    backgroundPollTimeoutRef.current = setTimeout(async () => {
      try {
        await fetchOrder();
      } catch {}
    }, 3500);
  }, [fetchOrder]);

  async function pollUntilPaid(opts?: { timeoutMs?: number; intervalMs?: number }) {
    const timeoutMs = opts?.timeoutMs ?? 45000;
    const intervalMs = opts?.intervalMs ?? 1500;

    const started = Date.now();
    setVerifyingPay(true);

    try {
      while (
        isMountedRef.current &&
        !isFinalStatus(order?.status ?? "pending") &&
        Date.now() - started < timeoutMs
      ) {
        let status = "unpaid";

        try {
          status = await fetchPaymentStatusOnly();
          
        } catch (e) {
          console.warn("poll payment_status error:", (e as any)?.message ?? e);
        }

        if (status === "paid") {
          await fetchOrder();
          if (isMountedRef.current) setPaymentPending(false);
          return true;
        }

        await new Promise((r) => setTimeout(r, intervalMs));
      }

      return false;
    } finally {
      if (isMountedRef.current) setVerifyingPay(false);
    }
  }

  const paymentTitle = useMemo(() => ts("common.payment.title", "Payment"), [i18n.language, ts]);

  async function handleLocalPaymentSelection(method: PaymentMethodOption) {
    if (!order?.id) return;
    setPaymentPickerVisible(false);

    try {
      setPaying(true);
      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (error || !accessToken) {
        throw new Error(ts("client.orderDetails.mustBeLoggedInToPay", "You must be logged in to pay."));
      }

      const countryCode = inferCountryCode({
        currency: order.currency,
      });

      const result = await startLocalPaymentForMethod(accessToken, {
        entityType: "order",
        entityId: order.id,
        countryCode,
        methodCode: method.method_code,
      });

      await fetchOrder();

      if (result.paid) {
        Alert.alert(
          paymentTitle,
          `${ts("client.orderDetails.paymentConfirmed", "Payment confirmed")} ✅`
        );
        return;
      }

      Alert.alert(paymentTitle, result.error ?? ts("client.orderDetails.paymentError", "Payment error."));
    } catch (e: unknown) {
      Alert.alert(
        paymentTitle,
        e instanceof Error ? e.message : ts("client.orderDetails.paymentError", "Payment error.")
      );
    } finally {
      if (isMountedRef.current) setPaying(false);
    }
  }

  async function handlePay() {
    if (!order?.id || paying || verifyingPay || paymentPending || canceling) return;

    if (isFinalStatus(order.status)) {
      Alert.alert(
        paymentTitle,
        ts("client.orderDetails.paymentClosed", "Payment is closed for this order.")
      );
      return;
    }

    const currentStatus = normalizePaymentStatus(order.payment_status);
    if (currentStatus === "paid") {
      Alert.alert(paymentTitle, ts("client.orderDetails.alreadyPaid", "Already paid ✅"));
      return;
    }

    try {
      setPaying(true);
      setPaymentPending(false);

      const apiUrl = cleanApiUrl() || getApiBaseUrl();

      if (!apiUrl) throw new Error("EXPO_PUBLIC_API_URL is missing");

      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      if (error) console.warn("getSession error (handlePay) =", error.message);

      if (!accessToken) {
        throw new Error(ts("client.orderDetails.mustBeLoggedInToPay", "You must be logged in to pay."));
      }

      const countryCode = inferCountryCode({ currency: order.currency });
      if (shouldOfferLocalMobileMoney(countryCode)) {
        setLoadingPaymentMethods(true);
        setPaymentPickerVisible(true);
        const methods = await loadLocalPaymentMethods(accessToken, {
          entityType: "order",
          entityId: order.id,
          countryCode,
        });
        setPaymentMethods(methods);
        setLoadingPaymentMethods(false);
        if (isMountedRef.current) setPaying(false);
        return;
      }

      let paymentSheetSucceeded = false;

      try {
        const sheetPaid = await payOrderWithPaymentSheet(order.id);
        if (sheetPaid) {
          paymentSheetSucceeded = true;
          const confirmSheet = await confirmOrderPaid(order.id, accessToken, {
            attempts: 3,
            timeoutMs: 12000,
          });
          await fetchOrder();
          const latestPaid = await fetchPaymentStatusOnly();
          if (confirmSheet.ok || latestPaid === "paid") {
            void mmdAudio.play("paymentSuccess");
            Alert.alert(
              paymentTitle,
              `${ts("client.orderDetails.paymentConfirmed", "Payment confirmed")} ✅`
            );
            return;
          }

          Alert.alert(
            paymentTitle,
            ts(
              "client.orderDetails.paymentSheetPendingConfirm",
              "Payment received. Your order will be marked paid shortly via Stripe. Pull to refresh in a few seconds — do not pay again."
            )
          );
          return;
        }
      } catch (sheetErr: unknown) {
        const msg =
          sheetErr instanceof Error ? sheetErr.message : String(sheetErr);
        if (msg.includes("already paid") || msg.includes("Order already paid")) {
          await fetchOrder();
          Alert.alert(paymentTitle, ts("client.orderDetails.alreadyPaid", "Already paid ✅"));
          return;
        }
        if (paymentSheetSucceeded) {
          await fetchOrder();
          Alert.alert(
            paymentTitle,
            ts(
              "client.orderDetails.paymentSheetPendingConfirm",
              "Payment received. Your order will be marked paid shortly via Stripe. Pull to refresh in a few seconds — do not pay again."
            )
          );
          return;
        }
        console.warn("[ClientOrderDetails] PaymentSheet failed, trying Checkout:", msg);
      }

      const endpoint = `${apiUrl}/api/stripe/client/create-checkout-session`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ order_id: order.id, orderId: order.id }),
      });

      if (!res.ok) {
        const msg = await readErrorBody(res);
        throw new Error(msg || `Checkout failed (${res.status})`);
      }

      const out = (await res.json()) as CreateCheckoutResponse;

      if (!out?.url) {
        throw new Error(out?.error || "Missing Checkout URL");
      }

      const sessionId = (out.session_id ?? "").toString().trim();

      if (sessionId) {
        await openStripeCheckout({
          checkoutUrl: out.url,
          orderId: order.id,
          sessionId,
        });
      } else {
        await WebBrowser.openBrowserAsync(out.url);
      }

      const confirm = await confirmOrderPaid(order.id, accessToken, {
        attempts: 3,
        timeoutMs: 12000,
      });

      await fetchOrder();

      if (confirm.ok) {
        const latestPaid = await fetchPaymentStatusOnly();
        if (latestPaid === "paid") {
          Alert.alert(
            paymentTitle,
            `${ts("client.orderDetails.paymentConfirmed", "Payment confirmed")} ✅`
          );
          return;
        }
      }

      const latestStatus = await fetchPaymentStatusOnly();

      if (isMountedRef.current && latestStatus !== "paid") {
        setPaymentPending(true);
      }

      const ok = await pollUntilPaid({ timeoutMs: 45000, intervalMs: 1500 });

      if (ok) {
        Alert.alert(paymentTitle, `${ts("client.orderDetails.paymentConfirmed", "Payment confirmed")} ✅`);
        return;
      }

      if (isMountedRef.current) {
        setPaymentPending(true);
      }
      scheduleBackgroundPaymentRefresh();

      Alert.alert(
        paymentTitle,
        ts(
          "client.orderDetails.paymentDelayHint",
          "Stripe received the payment ✅\nApp confirmation is still syncing.\nPlease wait a few seconds — this screen will refresh automatically."
        )
      );
    } catch (e: any) {
      if (isMountedRef.current) setPaymentPending(false);
      Alert.alert(paymentTitle, e?.message ?? ts("client.orderDetails.paymentError", "Payment error."));
    } finally {
      if (isMountedRef.current) setPaying(false);
    }
  }

  async function handleCancelOrder() {
    if (!order?.id || canceling || paying || verifyingPay || paymentPending) return;

    const apiUrl = cleanApiUrl();

    if (!apiUrl) {
      Alert.alert(
        ts("common.error", "Error"),
        "EXPO_PUBLIC_API_URL is missing. Set it to your web API URL."
      );
      return;
    }

    if (!(order.status === "pending" || order.status === "accepted")) {
      Alert.alert(
        ts("client.orderDetails.cancelTitle", "Cancel order"),
        ts("client.orderDetails.cancelUnavailable", "This order can no longer be cancelled from this screen.")
      );
      return;
    }

    const refundMessage =
      order.status === "pending"
        ? ts("client.orderDetails.cancelFullRefundHint", "Because the restaurant has not accepted yet, this cancellation should be eligible for a full refund review.")
        : ts("client.orderDetails.cancelNoRefundHint", "The restaurant has already accepted this order. Cancelling now may not be refundable.");

    Alert.alert(
      ts("client.orderDetails.cancelTitle", "Cancel order"),
      refundMessage,
      [
        {
          text: ts("common.keepOrder", "Keep order"),
          style: "cancel",
        },
        {
          text: ts("client.orderDetails.confirmCancel", "Cancel order"),
          style: "destructive",
          onPress: async () => {
            try {
              setCanceling(true);

              const { data, error } = await supabase.auth.getSession();
              const accessToken = data.session?.access_token;

              if (error) console.warn("getSession error (handleCancelOrder) =", error.message);

              if (!accessToken) {
                throw new Error(ts("common.mustBeLoggedIn", "You must be logged in."));
              }

              const endpoint = `${apiUrl}/api/orders/cancel`;

              const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  orderId: order.id,
                  order_id: order.id,
                  role: "client",
                }),
              });

              const out = (await res.json().catch(() => ({}))) as CancelOrderResponse;

              if (!res.ok || !out?.ok) {
                throw new Error(out?.error || `Cancel failed (${res.status})`);
              }

              await fetchOrder();

              const refundText =
                out.refund === "FULL"
                  ? ts("client.orderDetails.cancelRefundFull", "Cancellation completed. Refund status: full refund required.")
                  : ts("client.orderDetails.cancelRefundNone", "Cancellation completed. Refund status: no refund.");

              Alert.alert(ts("client.orderDetails.cancelSuccess", "Order cancelled"), refundText);
            } catch (e: any) {
              Alert.alert(
                ts("client.orderDetails.cancelTitle", "Cancel order"),
                e?.message ?? ts("client.orderDetails.cancelError", "Unable to cancel this order.")
              );
            } finally {
              if (isMountedRef.current) setCanceling(false);
            }
          },
        },
      ]
    );
  }

  const communicationDisabled = useMemo(
    () =>
      !order ||
      !!calling ||
      loading ||
      !!errorMsg ||
      canceling ||
      paying ||
      verifyingPay ||
      paymentPending ||
      isFinalStatus(order.status),
    [calling, loading, errorMsg, canceling, paying, verifyingPay, paymentPending, order]
  );

  const startOrderCall = useCallback(
    async (targetRole: CommunicationTarget) => {
      if (!order?.id || calling || loading || canceling || paying || verifyingPay || paymentPending || errorMsg) return;

      if (isFinalStatus(order.status)) {
        Alert.alert(
          ts("common.error", "Error"),
          ts("client.orderDetails.callFinalOrder", "Calls are disabled for this order.")
        );
        return;
      }

      if (targetRole === "driver" && !order.driver_id) {
        Alert.alert(
          ts("common.error", "Error"),
          ts("client.orderDetails.driverNotAssignedCall", "No driver is assigned to this order yet.")
        );
        return;
      }

      setCalling(targetRole);

      try {
        await startMaskedCall({
          orderId: order.id,
          callerRole: "client",
          targetRole,
        });
      } finally {
        if (isMountedRef.current) setCalling(null);
      }
    },
    [calling, loading, canceling, paying, verifyingPay, paymentPending, errorMsg, order, ts]
  );

  const callRestaurant = useCallback(() => {
    void startOrderCall("restaurant");
  }, [startOrderCall]);

  const callDriver = useCallback(() => {
    void startOrderCall("driver");
  }, [startOrderCall]);

  const callAdmin = useCallback(() => {
    void startOrderCall("admin");
  }, [startOrderCall]);

  const openOrderChat = useCallback(
    (targetRole: CommunicationTarget) => {
      if (!orderId || !order) return;

      if (isFinalStatus(order.status)) {
        Alert.alert(
          ts("common.error", "Error"),
          ts("client.orderDetails.chatClosed", "Messaging is disabled for this order.")
        );
        return;
      }

      if (targetRole === "driver" && !order.driver_id) {
        Alert.alert(
          ts("common.error", "Error"),
          ts("client.orderDetails.driverNotAssignedMessage", "No driver is assigned to this order yet.")
        );
        return;
      }

      (navigation as any).navigate("ClientChat", {
        orderId,
        targetRole,
      });
    },
    [navigation, orderId, order, ts]
  );

  const messageRestaurant = useCallback(() => {
    openOrderChat("restaurant");
  }, [openOrderChat]);

  const messageDriver = useCallback(() => {
    if (!order?.driver_id) {
      Alert.alert(
        ts("common.error", "Error"),
        ts("client.orderDetails.driverNotAssignedMessage", "No driver is assigned to this order yet.")
      );
      return;
    }

    openOrderChat("driver");
  }, [openOrderChat, order?.driver_id, ts]);

  const messageAdmin = useCallback(() => {
    openOrderChat("admin");
  }, [openOrderChat]);

  function formatStatus(status: OrderStatus) {
    switch (status) {
      case "pending":
        return ts("orders.status.pendingRestaurant", "Pending");
      case "accepted":
        return ts("orders.status.acceptedRestaurant", "Accepted");
      case "prepared":
        return ts("orders.status.prepared", "Preparing");
      case "ready":
        return ts("orders.status.readyWaitingDriver", "Ready (waiting driver)");
      case "dispatched":
        return ts("orders.status.dispatched", "On the way");
      case "delivered":
        return ts("orders.status.delivered", "Delivered");
      case "canceled":
        return ts("orders.status.canceled", "Canceled");
      default:
        return String(status);
    }
  }

  const isPaid = normalizePaymentStatus(order?.payment_status) === "paid";
  const showPaymentProcessing = !isPaid && (verifyingPay || paymentPending);

  const payableAmount = useMemo(() => {
    const grandTotal = Number(order?.grand_total);
    if (Number.isFinite(grandTotal) && grandTotal > 0) return grandTotal;

    const total = Number(order?.total);
    if (Number.isFinite(total) && total > 0) return total;

    const deliveryFee = Number(order?.delivery_fee);
    if (Number.isFinite(deliveryFee) && deliveryFee > 0) return deliveryFee;

    return 0;
  }, [order?.grand_total, order?.total, order?.delivery_fee]);

  const canPay =
    !!order &&
    order.status === "pending" &&
    !isFinalStatus(order.status) &&
    payableAmount > 0 &&
    !loading &&
    !errorMsg &&
    !isPaid &&
    !paymentPending &&
    !canceling &&
    !paying &&
    !verifyingPay;

  const canCancel =
    !!order &&
    (order.status === "pending" || order.status === "accepted") &&
    !isFinalStatus(order.status) &&
    !loading &&
    !errorMsg &&
    !canceling &&
    !calling &&
    !paying &&
    !verifyingPay &&
    !paymentPending;

  const driverId = order?.driver_id ?? null;
  const { location: liveDriver } = useLiveDriverLocation(driverId);

  const pickupCoord = useMemo(() => {
    if (!isValidCoordinate(order?.pickup_lat, order?.pickup_lng)) return null;
    return { latitude: Number(order?.pickup_lat), longitude: Number(order?.pickup_lng) };
  }, [order?.pickup_lat, order?.pickup_lng]);

  const dropoffCoord = useMemo(() => {
    if (!isValidCoordinate(order?.dropoff_lat, order?.dropoff_lng)) return null;
    return { latitude: Number(order?.dropoff_lat), longitude: Number(order?.dropoff_lng) };
  }, [order?.dropoff_lat, order?.dropoff_lng]);

  const driverCoord = useMemo(() => {
    if (!liveDriver) return null;
    if (!isValidCoordinate(liveDriver.lat, liveDriver.lng)) return null;
    return { latitude: Number(liveDriver.lat), longitude: Number(liveDriver.lng) };
  }, [liveDriver]);

  const polylineCoords = useMemo(() => {
    const coords: { latitude: number; longitude: number }[] = [];
    if (pickupCoord) coords.push(pickupCoord);
    if (dropoffCoord) coords.push(dropoffCoord);
    return coords;
  }, [pickupCoord, dropoffCoord]);

  const mapPoints = useMemo(() => {
    const pts: LatLng[] = [];
    if (pickupCoord) pts.push(pickupCoord);
    if (dropoffCoord) pts.push(dropoffCoord);
    if (driverCoord) pts.push(driverCoord);
    return pts;
  }, [pickupCoord, dropoffCoord, driverCoord]);

  const routeLineFeature = useMemo(() => makeLineFeature(polylineCoords), [polylineCoords]);

  const initialCamera = useMemo(() => getCameraForCoords(mapPoints), [mapPoints]);

  const fitMapToTrip = useCallback(() => {
    if (mapPoints.length === 0) return;

    const camera = getCameraForCoords(mapPoints);

    cameraRef.current?.setCamera({
      centerCoordinate: camera.centerCoordinate,
      zoomLevel: camera.zoomLevel,
      animationDuration: 650,
      animationMode: "flyTo",
    });
  }, [mapPoints]);

  useEffect(() => {
    if (!order) return;
    if (didFitRef.current) return;

    if (mapPoints.length > 0) {
      const tt = setTimeout(() => {
        fitMapToTrip();
        didFitRef.current = true;
      }, 350);
      return () => clearTimeout(tt);
    }
  }, [order, mapPoints, fitMapToTrip]);

  const meta = statusMeta(order?.status ?? "pending", ts);
  const progress = statusProgress(order?.status ?? "pending");
  const orderShort = compactId(orderId);
  const createdCompact = formatCompactDate(order?.created_at ?? null);

  const loyalty = useMemo(() => {
    const basePoints = order?.status === "delivered" ? 10 : 0;
    const ratingBonus = order?.status === "delivered" ? (rating >= 4 ? 5 : 2) : 0;
    const total = basePoints + ratingBonus;
    const levelName = total >= 120 ? "Gold" : total >= 50 ? "Silver" : "Bronze";
    const levelProgress = Math.max(
      0.05,
      Math.min(1, total / (levelName === "Bronze" ? 50 : levelName === "Silver" ? 120 : 200))
    );
    return { total, levelName, levelProgress };
  }, [order?.status, rating]);

  async function copyDropoffCode() {
    if (!order?.dropoff_code) return;

    try {
      const code = order.dropoff_code;

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Clipboard = require("expo-clipboard");
        if (Clipboard?.setStringAsync) await Clipboard.setStringAsync(String(code));
        else if (Clipboard?.setString) Clipboard.setString(String(code));
        else throw new Error("Clipboard unavailable");
      } catch {
        Alert.alert(ts("common.copy", "Copy"), String(code));
      }

      setCodeCopied(true);
      setTimeout(() => {
        if (isMountedRef.current) setCodeCopied(false);
      }, 1800);
    } catch {}
  }

  const Card = ({ children, style }: { children: React.ReactNode; style?: any }) => (
    <View
      style={[
        {
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "#111827",
          backgroundColor: "rgba(2,6,23,0.60)",
          padding: 14,
        },
        style,
      ]}
    >
      {children}
    </View>
  );

  const InfoRow = ({ label, value, valueStyle }: { label: string; value: string; valueStyle?: any }) => (
    <View style={{ marginBottom: 8 }}>
      <Text style={{ color: "#94A3B8", fontSize: 12 }}>
        {label}
        {"  "}
        <Text style={[{ color: "#E5E7EB", fontWeight: "800" }, valueStyle]}>{value}</Text>
      </Text>
    </View>
  );

  const Stars = ({ disabled }: { disabled?: boolean }) => (
    <View style={{ flexDirection: "row", marginTop: 12 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = rating >= n;
        return (
          <TouchableOpacity
            key={n}
            disabled={disabled}
            onPress={() => setRating(n)}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 10,
              marginRight: 8,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: on ? "rgba(251,191,36,0.70)" : "#374151",
              backgroundColor: on ? "rgba(251,191,36,0.12)" : "transparent",
            }}
          >
            <Text style={{ color: on ? "#FBBF24" : "#64748B", fontWeight: "900", fontSize: 16 }}>
              {on ? "★" : "☆"}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );


  const ProfileAvatar = ({
    name,
    avatarUrl,
    fallback,
    borderColor,
  }: {
    name: string | null | undefined;
    avatarUrl?: string | null;
    fallback: string;
    borderColor: string;
  }) => {
    const uri = normalizeAvatarUrl(avatarUrl);
    const initialsText = getInitials(name, fallback);

    if (uri) {
      return (
        <Image
          source={{ uri }}
          style={{
            width: 46,
            height: 46,
            borderRadius: 23,
            borderWidth: 1,
            borderColor,
            backgroundColor: "#0B1220",
          }}
        />
      );
    }

    return (
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          borderWidth: 1,
          borderColor,
          backgroundColor: "rgba(15,23,42,0.95)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 13 }}>
          {initialsText}
        </Text>
      </View>
    );
  };

  const ParticipantCard = ({
    roleIcon,
    title,
    name,
    avatarUrl,
    status,
    accent,
    children,
  }: {
    roleIcon: string;
    title: string;
    name: string;
    avatarUrl?: string | null;
    status: string;
    accent: string;
    children?: React.ReactNode;
  }) => (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "rgba(148,163,184,0.14)",
        backgroundColor: "rgba(15,23,42,0.45)",
        padding: 12,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <ProfileAvatar
          name={name}
          avatarUrl={avatarUrl}
          fallback={roleIcon === "🚚" ? "DR" : roleIcon === "🍽️" ? "RS" : "AD"}
          borderColor={accent}
        />

        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 14 }}
          >
            {roleIcon} {title}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: "white", fontWeight: "900", fontSize: 15, marginTop: 3 }}
          >
            {name}
          </Text>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ color: accent, fontWeight: "800", fontSize: 11, marginTop: 3 }}
          >
            {status}
          </Text>
        </View>
      </View>

      {children}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1 }}>
        <ScreenHeader
          title={order ? meta.title : ts("client.orderDetails.loadingTitle", "Order")}
          subtitle={`🕒 ${createdCompact}`}
          fallbackRoute="ClientHome"
          variant="dark"
          rightSlot={
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: meta.pillBorder,
                backgroundColor: meta.pillBg,
              }}
            >
              <Text style={{ color: meta.pillText, fontWeight: "900", fontSize: 12 }}>#{orderShort}</Text>
            </View>
          }
        />

        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
            <View
              style={{
                height: 6,
                borderRadius: 999,
                backgroundColor: "rgba(148,163,184,0.10)",
                borderWidth: 1,
                borderColor: "rgba(148,163,184,0.14)",
                marginTop: 10,
                overflow: "hidden",
              }}
            >
              <View
                style={{
                  height: 6,
                  width: `${Math.round(progress * 100)}%`,
                  backgroundColor: order?.status === "canceled" ? "rgba(248,113,113,0.55)" : "rgba(34,197,94,0.55)",
                }}
              />
            </View>

            {!!order && isPaid && (
              <Text style={{ color: "#22C55E", fontSize: 12, marginTop: 8, fontWeight: "900" }}>
                ✅ {ts("client.orderDetails.paymentConfirmed", "Payment confirmed")}
              </Text>
            )}

            {!!order && showPaymentProcessing && (
              <Text style={{ color: "#FBBF24", fontSize: 12, marginTop: 8, fontWeight: "900" }}>
                ⏳ {ts("client.orderDetails.verifyingPayment", "Verifying payment…")}
              </Text>
            )}
        </View>

        {!loading && !errorMsg && order && (pickupCoord || dropoffCoord) && (
          <>
            <View
                style={{
                  height: 250,
                  marginTop: 12,
                  marginHorizontal: 20,
                  borderRadius: 18,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.14)",
                  backgroundColor: "rgba(2,6,23,0.7)",
                }}
              >
                <Mapbox.MapView
                  style={{ flex: 1 }}
                  styleURL={getMapStyleStreets()}
                  logoEnabled={false}
                  attributionEnabled={false}
                  compassEnabled
                  surfaceView={false}
                >
                  <Mapbox.Camera
                    ref={cameraRef}
                    allowUpdates
                    centerCoordinate={initialCamera.centerCoordinate}
                    zoomLevel={initialCamera.zoomLevel}
                    animationMode="flyTo"
                    animationDuration={650}
                  />

                  {pickupCoord && (
                    <Mapbox.PointAnnotation id="client-pickup" coordinate={toMapboxCoord(pickupCoord)}>
                      <View
                        style={{
                          paddingHorizontal: 9,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "#2563EB",
                          borderWidth: 2,
                          borderColor: "#FFFFFF",
                        }}
                      >
                        <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "900" }}>PICKUP</Text>
                      </View>
                    </Mapbox.PointAnnotation>
                  )}

                  {dropoffCoord && (
                    <Mapbox.PointAnnotation id="client-dropoff" coordinate={toMapboxCoord(dropoffCoord)}>
                      <View
                        style={{
                          paddingHorizontal: 9,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: "#16A34A",
                          borderWidth: 2,
                          borderColor: "#FFFFFF",
                        }}
                      >
                        <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "900" }}>DROPOFF</Text>
                      </View>
                    </Mapbox.PointAnnotation>
                  )}

                  {driverCoord && (
                    <Mapbox.PointAnnotation id="client-live-driver" coordinate={toMapboxCoord(driverCoord)}>
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 17,
                          backgroundColor: "#F97316",
                          borderWidth: 3,
                          borderColor: "#FFFFFF",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>D</Text>
                      </View>
                    </Mapbox.PointAnnotation>
                  )}

                  {polylineCoords.length === 2 && (
                    <Mapbox.ShapeSource id="client-route-source" shape={routeLineFeature}>
                      <Mapbox.LineLayer
                        id="client-route-shadow"
                        style={{
                          lineColor: "rgba(59,130,246,0.18)",
                          lineWidth: 8,
                          lineCap: "round",
                          lineJoin: "round",
                        }}
                      />
                      <Mapbox.LineLayer
                        id="client-route-line"
                        style={{
                          lineColor: "rgba(147,197,253,0.95)",
                          lineWidth: 3,
                          lineCap: "round",
                          lineJoin: "round",
                        }}
                      />
                    </Mapbox.ShapeSource>
                  )}
                </Mapbox.MapView>

                <View style={{ position: "absolute", top: 12, right: 12 }}>
                  <TouchableOpacity
                    onPress={() => {
                      didFitRef.current = false;
                      fitMapToTrip();
                      didFitRef.current = true;
                    }}
                    style={{
                      paddingVertical: 9,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      backgroundColor: "rgba(2,6,23,0.86)",
                      borderWidth: 1,
                      borderColor: "rgba(148,163,184,0.18)",
                    }}
                  >
                    <Text style={{ color: "#93C5FD", fontWeight: "900", fontSize: 12 }}>
                      ⤾ {ts("client.orderDetails.rezoom", "Re-zoom")}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={{ position: "absolute", left: 12, bottom: 12, right: 12 }}>
                  <View
                    style={{
                      borderRadius: 14,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      backgroundColor: "rgba(2,6,23,0.82)",
                      borderWidth: 1,
                      borderColor: "rgba(148,163,184,0.14)",
                    }}
                  >
                    <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 12 }}>
                      {ts("client.orderDetails.map.live", "Live trip view")}
                      {!!order.driver_id ? " • " + ts("client.orderDetails.driverAssigned", "Driver assigned ✅") : ""}
                    </Text>
                    {!!order.driver_id && !driverCoord && (
                      <Text style={{ color: "#FBBF24", marginTop: 4, fontSize: 11, fontWeight: "800" }}>
                        ⏳ {ts("client.orderDetails.waitingDriverLocation", "Waiting for driver location…")}
                      </Text>
                    )}
                    {!!driverCoord && liveDriver?.updated_at && (
                      <Text style={{ color: "#93C5FD", marginTop: 4, fontSize: 11, fontWeight: "800" }}>
                        {ts("client.orderDetails.map.lastUpdate", "Last update:")} {new Date(liveDriver.updated_at).toLocaleTimeString()}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
          </>
        )}

        {loading && (
          <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
            <ActivityIndicator size="large" color="#22C55E" />
            <Text style={{ marginTop: 8, color: "#9CA3AF", fontWeight: "800" }}>
              {ts("shared.common.loading", "Loading…")}
            </Text>
          </View>
        )}

        {!loading && !!errorMsg && (
          <View style={{ padding: 20 }}>
            <View
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "rgba(248,113,113,0.35)",
                backgroundColor: "rgba(2,6,23,0.60)",
                padding: 14,
              }}
            >
              <Text style={{ color: "#FCA5A5", fontWeight: "900", marginBottom: 6 }}>{ts("common.error", "Error")}</Text>
              <Text style={{ color: "#E5E7EB" }}>{String(errorMsg)}</Text>

              <TouchableOpacity onPress={fetchOrder} style={{ marginTop: 12 }}>
                <Text style={{ color: "#60A5FA", fontWeight: "900" }}>↻ {ts("common.retry", "Retry")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!loading && !errorMsg && order && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 44 }}>
            <Card style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: "white", fontSize: 14, fontWeight: "900" }}>
                    🔐 {ts("client.orderDetails.dropoffCodeTitleShort", "Secure delivery code")}
                  </Text>
                  <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 6, lineHeight: 16 }}>
                    {ts("client.orderDetails.dropoffCodeHint", "Share this code with the driver at dropoff only.")}
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={copyDropoffCode}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 9,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: codeCopied ? "rgba(34,197,94,0.40)" : "rgba(148,163,184,0.18)",
                    backgroundColor: codeCopied ? "rgba(34,197,94,0.12)" : "rgba(2,6,23,0.60)",
                  }}
                >
                  <Text style={{ color: codeCopied ? "#86EFAC" : "#E5E7EB", fontWeight: "900", fontSize: 12 }}>
                    {codeCopied ? "Copied ✅" : ts("common.copy", "Copy")}
                  </Text>
                </TouchableOpacity>
              </View>

              <Text
                style={{
                  color: "#F9FAFB",
                  fontSize: 30,
                  fontWeight: "900",
                  letterSpacing: 2,
                  marginTop: 14,
                }}
              >
                {formatCodeSpaced(order.dropoff_code)}
              </Text>
            </Card>

            {order.status === "delivered" && (
              <Card
                style={{
                  marginBottom: 14,
                  borderColor: "rgba(34,197,94,0.22)",
                  backgroundColor: "rgba(34,197,94,0.06)",
                }}
              >
                <Text style={{ color: "white", fontSize: 14, fontWeight: "900" }}>
                  🎉 {ts("client.orderDetails.successTitle", "Delivery success")}
                </Text>
                <Text style={{ color: "#94A3B8", marginTop: 6, fontSize: 12, lineHeight: 16 }}>
                  {ts("client.orderDetails.successBody", "You earned loyalty points for completing this order.")}
                </Text>

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#86EFAC", fontWeight: "900", fontSize: 18 }}>+10</Text>
                    <Text style={{ color: "#94A3B8", fontSize: 11 }}>{ts("client.orderDetails.points", "points")}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 14 }}>
                      {ts("client.orderDetails.level", "Level")}: {loyalty.levelName}
                    </Text>
                    <View
                      style={{
                        height: 6,
                        borderRadius: 999,
                        backgroundColor: "rgba(148,163,184,0.12)",
                        borderWidth: 1,
                        borderColor: "rgba(148,163,184,0.14)",
                        marginTop: 8,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          height: 6,
                          width: `${Math.round(loyalty.levelProgress * 100)}%`,
                          backgroundColor: "rgba(34,197,94,0.55)",
                        }}
                      />
                    </View>
                  </View>
                </View>
              </Card>
            )}

            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
              <Card style={{ flex: 1, minWidth: 260 }}>
                <Text style={{ color: "white", fontSize: 14, fontWeight: "900", marginBottom: 10 }}>
                  📍 {ts("client.orderDetails.cards.route", "Route")}
                </Text>
                <InfoRow label={ts("client.orderDetails.pickup", "Pickup:")} value={order.pickup_address ?? "—"} />
                <InfoRow label={ts("client.orderDetails.dropoff", "Dropoff:")} value={order.dropoff_address ?? "—"} />
                <InfoRow
                  label={ts("client.orderDetails.distance", "Distance:")}
                  value={order.distance_miles != null ? `${order.distance_miles.toFixed(2)} mi` : "—"}
                />
              </Card>

              <Card style={{ flex: 1, minWidth: 260 }}>
                <Text style={{ color: "white", fontSize: 14, fontWeight: "900", marginBottom: 10 }}>
                  💰 {paymentTitle}
                </Text>
                <InfoRow label={ts("client.orderDetails.deliveryFee", "Delivery fee:")} value={money(order.delivery_fee)} />
                <InfoRow
                  label={ts("client.orderDetails.total", "Total:")}
                  value={money(payableAmount)}
                  valueStyle={{ color: "#E5E7EB" }}
                />
                <InfoRow
                  label={ts("client.orderDetails.payment", "Status:")}
                  value={
                    isPaid
                      ? ts("client.orderDetails.paid", "Paid ✅")
                      : showPaymentProcessing
                        ? ts("client.orderDetails.verifyingPayment", "Verifying payment…")
                        : ts("client.orderDetails.unpaid", "Unpaid")
                  }
                  valueStyle={{
                    color: isPaid ? "#22C55E" : showPaymentProcessing ? "#FBBF24" : "#FCA5A5",
                  }}
                />
              </Card>

              <Card style={{ flex: 1, minWidth: 260 }}>
                <Text style={{ color: "white", fontSize: 14, fontWeight: "900", marginBottom: 10 }}>
                  🚚 {ts("client.orderDetails.cards.delivery", "Delivery")}
                </Text>
                <InfoRow label={ts("client.orderDetails.status", "Status:")} value={formatStatus(order.status)} />
                <InfoRow
                  label={ts("client.orderDetails.driver", "Driver:")}
                  value={
                    order.driver_id
                      ? ts("client.orderDetails.driverAssigned", "Assigned ✅")
                      : ts("client.orderDetails.driverPending", "Not assigned yet")
                  }
                  valueStyle={{ color: order.driver_id ? "#22C55E" : "#94A3B8" }}
                />
                <InfoRow
                  label={ts("client.orderDetails.live", "Live tracking:")}
                  value={
                    order.driver_id
                      ? driverCoord
                        ? ts("client.orderDetails.liveOn", "Active ✅")
                        : ts("client.orderDetails.liveWaiting", "Waiting…")
                      : "—"
                  }
                  valueStyle={{ color: driverCoord ? "#93C5FD" : "#94A3B8" }}
                />
              </Card>
            </View>

            <Card style={{ marginBottom: 14 }}>
              <Text style={{ color: "white", fontSize: 14, fontWeight: "900", marginBottom: 8 }}>
                ☎️ {ts("client.orderDetails.communicationTitle", "Communication")}
              </Text>

              <Text style={{ color: "#94A3B8", fontSize: 12, lineHeight: 16, marginBottom: 12 }}>
                {ts(
                  "client.orderDetails.communicationHint",
                  "Call or message the restaurant, driver, or MMD support without exposing your real phone number."
                )}
              </Text>

              <View style={{ gap: 10 }}>
                <ParticipantCard
                  roleIcon="🍽️"
                  title={ts("client.orderDetails.restaurantContact", "Restaurant")}
                  name={
                    restaurantProfile?.restaurant_name ??
                    order.restaurant_name ??
                    ts("client.orderDetails.restaurantContact", "Restaurant")
                  }
                  avatarUrl={restaurantProfile?.avatar_url ?? null}
                  status={ts("client.orderDetails.restaurantVisible", "Restaurant profile visible")}
                  accent="#FBBF24"
                >
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity
                      disabled={communicationDisabled}
                      onPress={callRestaurant}
                      style={{
                        flex: 1,
                        backgroundColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(37,99,235,0.95)",
                        paddingVertical: 12,
                        borderRadius: 12,
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(59,130,246,0.35)",
                      }}
                    >
                      {calling === "restaurant" ? (
                        <ActivityIndicator color="white" />
                      ) : (
                        <Text style={{ color: "white", fontWeight: "900" }}>
                          📞 {ts("client.orderDetails.callRestaurant", "Call")}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      disabled={communicationDisabled}
                      onPress={messageRestaurant}
                      style={{
                        flex: 1,
                        opacity: communicationDisabled ? 0.5 : 1,
                        backgroundColor: "rgba(15,23,42,0.95)",
                        paddingVertical: 12,
                        borderRadius: 12,
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: "rgba(148,163,184,0.20)",
                      }}
                    >
                      <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                        💬 {ts("client.orderDetails.message", "Message")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ParticipantCard>

                <ParticipantCard
                  roleIcon="🚚"
                  title={ts("client.orderDetails.driverContact", "Driver")}
                  name={
                    driverProfile?.full_name ??
                    (order.driver_id
                      ? ts("client.orderDetails.driverAssigned", "Assigned driver")
                      : ts("client.orderDetails.driverPending", "Not assigned yet"))
                  }
                  avatarUrl={driverProfile?.avatar_url ?? null}
                  status={
                    order.driver_id
                      ? ts("client.orderDetails.driverAssigned", "Assigned ✅")
                      : ts("client.orderDetails.driverPending", "Not assigned yet")
                  }
                  accent={order.driver_id ? "#38BDF8" : "#94A3B8"}
                >
                  {!order.driver_id ? (
                    <Text style={{ color: "#94A3B8", fontSize: 12 }}>
                      {ts("client.orderDetails.driverPending", "Not assigned yet")}
                    </Text>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        disabled={communicationDisabled}
                        onPress={callDriver}
                        style={{
                          flex: 1,
                          backgroundColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(14,165,233,0.95)",
                          paddingVertical: 12,
                          borderRadius: 12,
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(14,165,233,0.35)",
                        }}
                      >
                        {calling === "driver" ? (
                          <ActivityIndicator color="white" />
                        ) : (
                          <Text style={{ color: "white", fontWeight: "900" }}>
                            📞 {ts("client.orderDetails.callDriver", "Call")}
                          </Text>
                        )}
                      </TouchableOpacity>

                      <TouchableOpacity
                        disabled={!order.driver_id || communicationDisabled}
                        onPress={messageDriver}
                        style={{
                          flex: 1,
                          opacity: !order.driver_id || communicationDisabled ? 0.5 : 1,
                          backgroundColor: "rgba(15,23,42,0.95)",
                          paddingVertical: 12,
                          borderRadius: 12,
                          alignItems: "center",
                          borderWidth: 1,
                          borderColor: "rgba(148,163,184,0.20)",
                        }}
                      >
                        <Text style={{ color: "#93C5FD", fontWeight: "900" }}>
                          💬 {ts("client.orderDetails.message", "Message")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </ParticipantCard>

                <View
                  style={{
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "rgba(124,58,237,0.22)",
                    backgroundColor: "rgba(124,58,237,0.08)",
                    padding: 12,
                  }}
                >
                  <Text style={{ color: "#EDE9FE", fontWeight: "900", marginBottom: 10 }}>
                    🛟 {ts("client.orderDetails.supportContact", "MMD support")}
                  </Text>

                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity
                      disabled={communicationDisabled}
                      onPress={callAdmin}
                      style={{
                        flex: 1,
                        backgroundColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(124,58,237,0.95)",
                        paddingVertical: 12,
                        borderRadius: 12,
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(124,58,237,0.35)",
                      }}
                    >
                      {calling === "admin" ? (
                        <ActivityIndicator color="white" />
                      ) : (
                        <Text style={{ color: "white", fontWeight: "900" }}>
                          📞 {ts("client.orderDetails.callSupport", "Call")}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      disabled={communicationDisabled}
                      onPress={messageAdmin}
                      style={{
                        flex: 1,
                        opacity: communicationDisabled ? 0.5 : 1,
                        backgroundColor: "rgba(15,23,42,0.95)",
                        paddingVertical: 12,
                        borderRadius: 12,
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: "rgba(148,163,184,0.20)",
                      }}
                    >
                      <Text style={{ color: "#C4B5FD", fontWeight: "900" }}>
                        💬 {ts("client.orderDetails.message", "Message")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Card>

            {canCancel && (
              <View style={{ marginTop: 2, marginBottom: 16 }}>
                <TouchableOpacity
                  onPress={handleCancelOrder}
                  disabled={canceling}
                  style={{
                    backgroundColor: canceling ? "rgba(148,163,184,0.18)" : "rgba(248,113,113,0.92)",
                    paddingVertical: 15,
                    borderRadius: 14,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: canceling ? "rgba(148,163,184,0.18)" : "rgba(248,113,113,0.35)",
                  }}
                >
                  {canceling ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: "white", fontSize: 15, fontWeight: "900" }}>
                      ❌ {ts("client.orderDetails.cancelOrder", "Cancel order")}
                    </Text>
                  )}
                </TouchableOpacity>

                <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 10, lineHeight: 16 }}>
                  {order.status === "pending"
                    ? ts(
                        "client.orderDetails.cancelPendingHint",
                        "You can cancel while the order is still pending restaurant acceptance."
                      )
                    : ts(
                        "client.orderDetails.cancelAcceptedHint",
                        "The restaurant has accepted this order. Cancelling may not be refundable."
                      )}
                </Text>
              </View>
            )}

            {order.status === "delivered" && (
              <Card>
                <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
                  ⭐ {ts("client.orderDetails.rateDriverTitle", "Rate your driver")}
                </Text>

                {alreadyRated ? (
                  <Text style={{ color: "#22C55E", marginTop: 10, fontWeight: "900" }}>
                    ✅ {ts("client.orderDetails.alreadyRated", "Thanks! You already rated this delivery.")}
                  </Text>
                ) : (
                  <Text style={{ color: "#94A3B8", marginTop: 10, fontSize: 12, lineHeight: 16 }}>
                    {ts("client.orderDetails.ratingHint", "Your review improves quality. You earn loyalty points for feedback ⭐")}
                  </Text>
                )}

                <Stars disabled={alreadyRated} />

                {!alreadyRated && (
                  <View
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: "rgba(148,163,184,0.14)",
                      backgroundColor: "rgba(148,163,184,0.06)",
                    }}
                  >
                    <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 12 }}>
                      🎁 {ts("client.orderDetails.rewardLine", "You earn")}{" "}
                      <Text style={{ color: "#86EFAC" }}>{rating >= 4 ? "+5" : "+2"}</Text>{" "}
                      {ts("client.orderDetails.points", "points")} {ts("client.orderDetails.forReview", "for your review")}
                    </Text>
                  </View>
                )}

                <View style={{ marginTop: 12 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 6 }}>
                    {ts("client.orderDetails.commentOptional", "Comment (optional)")}
                  </Text>
                  <TextInput
                    value={comment}
                    onChangeText={setComment}
                    placeholder={ts("client.orderDetails.commentPlaceholder", "Ex: Great communication, fast delivery…")}
                    placeholderTextColor="#6B7280"
                    multiline
                    style={{
                      minHeight: 90,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "rgba(148,163,184,0.18)",
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                      color: "#F9FAFB",
                      backgroundColor: "rgba(2,6,23,0.35)",
                    }}
                  />
                </View>

                <View style={{ marginTop: 14 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 8 }}>
                    💵 {ts("client.orderDetails.tipOptional", "Tip (optional)")}
                  </Text>

                  <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                    {TIP_PRESETS.map((v) => {
                      const selected = tipSelectedPreset === v;
                      return (
                        <TouchableOpacity
                          key={v}
                          onPress={() => setTipPreset(v)}
                          style={{
                            paddingVertical: 10,
                            paddingHorizontal: 14,
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: selected ? "rgba(34,197,94,0.45)" : "rgba(148,163,184,0.18)",
                            backgroundColor: selected ? "rgba(34,197,94,0.12)" : "transparent",
                            marginRight: 8,
                            marginBottom: 8,
                          }}
                        >
                          <Text style={{ color: selected ? "#86EFAC" : "#9CA3AF", fontWeight: "900" }}>${v}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={{ marginTop: 10 }}>
                    <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 6 }}>
                      {ts("client.orderDetails.tipOtherAmount", "Other amount")}
                    </Text>

                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: "rgba(148,163,184,0.18)",
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: "rgba(2,6,23,0.35)",
                      }}
                    >
                      <Text style={{ color: "#9CA3AF", fontWeight: "900", marginRight: 8 }}>$</Text>
                      <TextInput
                        value={tipCustom}
                        onChangeText={(txt) => {
                          const cleaned = sanitizeMoneyInput(txt);
                          setTipCustom(cleaned);
                          const dollars = parseMoneyToDollars(cleaned);
                          setTipDollars(dollars);
                        }}
                        placeholder={ts("client.orderDetails.tipPlaceholder", "ex: 25")}
                        placeholderTextColor="#6B7280"
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                        style={{
                          flex: 1,
                          color: "#F9FAFB",
                          fontWeight: "900",
                        }}
                      />
                    </View>

                    <Text style={{ color: "#64748B", fontSize: 11, marginTop: 6 }}>
                      {ts("client.orderDetails.tipMaxHint", "Recommended max:")} ${TIP_MAX_DOLLARS}.{" "}
                      {ts("client.orderDetails.tipMaxHint2", "(We can adjust later.)")}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  disabled={submittingReview || alreadyRated}
                  onPress={async () => {
                    if (submittingReview || alreadyRated || !order?.id) return;

                    try {
                      setSubmittingReview(true);

                      const { data: s } = await supabase.auth.getSession();
                      const uid = s.session?.user?.id;
                      if (!uid) throw new Error(ts("common.mustBeLoggedIn", "You must be logged in."));

                      const orderOwnerId = order.client_id ?? order.client_user_id ?? null;

                      if (orderOwnerId && uid !== orderOwnerId) {
                        throw new Error(
                          ts("client.orderDetails.notOwnerError", "You are not logged in as the order owner.") +
                            ` (auth=${uid} / owner=${orderOwnerId})`
                        );
                      }

                      const tipFromInput = parseMoneyToDollars(tipCustom);
                      const finalTipDollars = tipCustom.trim() ? tipFromInput : tipDollars;
                      const tip_cents = Math.max(0, Math.round((finalTipDollars || 0) * 100));

                      const { error: tipErr } = await supabase
                        .from("orders")
                        .update({ tip_cents })
                        .eq("id", order.id)
                        .eq("status", "delivered")
                        .or(`client_id.eq.${uid},client_user_id.eq.${uid},user_id.eq.${uid}`);
                      if (tipErr) throw tipErr;

                      const { error: ratingErr } = await supabase
                        .from("order_ratings")
                        .upsert(
                          {
                            order_id: order.id,
                            rater_id: uid,
                            rating,
                            comment: comment.trim() ? comment.trim().slice(0, 800) : null,
                          },
                          { onConflict: "order_id,rater_id" }
                        );
                      if (ratingErr) throw ratingErr;

                      setAlreadyRated(true);
                      await fetchOrder();

                      Alert.alert(
                        ts("common.thanks", "Thanks ✅") as any,
                        ts("client.orderDetails.reviewSaved", "Review saved. Tip added if selected.") as any
                      );
                    } catch (e: any) {
                      const msg = e?.message ?? ts("client.orderDetails.reviewSaveError", "Unable to save your review.");
                      if (String(msg).toLowerCase().includes("duplicate")) setAlreadyRated(true);
                      Alert.alert(ts("client.orderDetails.reviewTitle", "Review") as any, String(msg));
                    } finally {
                      if (isMountedRef.current) setSubmittingReview(false);
                    }
                  }}
                  style={{
                    marginTop: 16,
                    backgroundColor:
                      submittingReview || alreadyRated ? "rgba(148,163,184,0.18)" : "rgba(34,197,94,0.95)",
                    paddingVertical: 14,
                    borderRadius: 14,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: submittingReview || alreadyRated ? "rgba(148,163,184,0.18)" : "rgba(34,197,94,0.35)",
                  }}
                >
                  {submittingReview ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: "white", fontSize: 15, fontWeight: "900" }}>
                      {alreadyRated
                        ? ts("client.orderDetails.alreadyRatedBtn", "Already submitted ✅")
                        : ts("client.orderDetails.sendReview", "Send review ⭐ + Tip")}
                    </Text>
                  )}
                </TouchableOpacity>
              </Card>
            )}

            {canPay && (
              <View style={{ marginTop: 16 }}>
                <TouchableOpacity
                  onPress={handlePay}
                  disabled={paying || verifyingPay || paymentPending}
                  style={{
                    backgroundColor:
                      paying || verifyingPay || paymentPending
                        ? "rgba(148,163,184,0.18)"
                        : "rgba(34,197,94,0.95)",
                    paddingVertical: 16,
                    borderRadius: 14,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor:
                      paying || verifyingPay || paymentPending
                        ? "rgba(148,163,184,0.18)"
                        : "rgba(34,197,94,0.35)",
                  }}
                >
                  {paying || verifyingPay || paymentPending ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: "white", fontSize: 16, fontWeight: "900" }}>
                      {ts("client.orderDetails.pay", "Pay")} {money(payableAmount)}
                    </Text>
                  )}
                </TouchableOpacity>

                <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 10, lineHeight: 16 }}>
                  🔒 {ts("client.orderDetails.stripeHint", "Secure payment by Stripe (Web Checkout).")}
                </Text>
              </View>
            )}

            {!!order && isPaid && (
              <View style={{ marginTop: 14 }}>
                <Text style={{ color: "#94A3B8", fontSize: 12, lineHeight: 16 }}>
                  ✅{" "}
                  {ts(
                    "client.orderDetails.alreadyPaidHint",
                    "This order is already paid. You can wait for restaurant/driver progress."
                  )}
                </Text>
              </View>
            )}

            {!!order && !isPaid && paymentPending && (
              <View style={{ marginTop: 14 }}>
                <Text style={{ color: "#FBBF24", fontSize: 12, lineHeight: 16, fontWeight: "800" }}>
                  ⏳{" "}
                  {ts(
                    "client.orderDetails.paymentStillSyncing",
                    "Payment is being confirmed by the app. No need to pay again."
                  )}
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
      <PaymentMethodPicker
        visible={paymentPickerVisible}
        title={paymentTitle}
        methods={paymentMethods}
        loading={loadingPaymentMethods}
        onClose={() => setPaymentPickerVisible(false)}
        onSelect={handleLocalPaymentSelection}
      />
    </SafeAreaView>
  );
}


export default ClientOrderDetailsScreen;
