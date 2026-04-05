// apps/mobile/src/screens/ClientOrderDetailsScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  SafeAreaView,
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
  Platform,
} from "react-native";
import { useRoute, useNavigation, useFocusEffect } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import * as WebBrowser from "expo-web-browser";
import Constants from "expo-constants";
import { openStripeCheckout } from "../lib/stripe";
import { useTranslation } from "react-i18next";

// ✅ Map + live driver location (react-native-maps requires a Dev Build; Expo Go may crash)
// We load it dynamically to avoid "Cannot read property 'default' of undefined" in Expo Go.
type MapsModule = typeof import("react-native-maps");
let Maps: MapsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Maps = require("react-native-maps");
} catch {
  Maps = null;
}

// ✅ Live driver hook
import { useLiveDriverLocation } from "../hooks/useLiveDriverLocation";

// ✅ API URL: fallback robuste via expoConfig.extra
const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE_URL;

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
  driver_id?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  tip_cents?: number | null;
  client_user_id?: string | null;
};

type CreateCheckoutResponse = {
  url?: string;
  session_id?: string;
  error?: string;
};

// =========================
// ✅ Helpers
// =========================
function maskToken(t?: string | null) {
  if (!t) return "null";
  if (t.length <= 18) return t;
  return `${t.slice(0, 10)}...${t.slice(-6)}`;
}

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

function statusMeta(status: OrderStatus) {
  switch (status) {
    case "delivered":
      return {
        title: "Delivered ✅",
        pillBg: "rgba(34,197,94,0.14)",
        pillBorder: "rgba(34,197,94,0.32)",
        pillText: "#86EFAC",
      };
    case "dispatched":
      return {
        title: "On the way 🚚",
        pillBg: "rgba(59,130,246,0.14)",
        pillBorder: "rgba(59,130,246,0.30)",
        pillText: "#93C5FD",
      };
    case "ready":
      return {
        title: "Ready ✅",
        pillBg: "rgba(251,191,36,0.12)",
        pillBorder: "rgba(251,191,36,0.28)",
        pillText: "#FBBF24",
      };
    case "prepared":
      return {
        title: "Preparing 🍳",
        pillBg: "rgba(148,163,184,0.10)",
        pillBorder: "rgba(148,163,184,0.20)",
        pillText: "#CBD5E1",
      };
    case "accepted":
      return {
        title: "Accepted ✅",
        pillBg: "rgba(148,163,184,0.10)",
        pillBorder: "rgba(148,163,184,0.20)",
        pillText: "#CBD5E1",
      };
    case "pending":
      return {
        title: "Pending ⏳",
        pillBg: "rgba(148,163,184,0.10)",
        pillBorder: "rgba(148,163,184,0.20)",
        pillText: "#CBD5E1",
      };
    case "canceled":
      return {
        title: "Canceled ✖",
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

export function ClientOrderDetailsScreen() {
  const { t, i18n } = useTranslation();
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { orderId } = route.params;

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

  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [tipDollars, setTipDollars] = useState<number>(0);
  const [tipCustom, setTipCustom] = useState<string>("");
  const [submittingReview, setSubmittingReview] = useState(false);
  const [alreadyRated, setAlreadyRated] = useState(false);

  const [codeCopied, setCodeCopied] = useState(false);

  const isMountedRef = useRef(true);
  const backgroundPollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapRef = useRef<any>(null);
  const didFitRef = useRef(false);

  const mapsAvailable = !!Maps?.default;

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
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      console.log("API_URL (resolved) =", API_URL);
      console.log("SUPABASE_URL =", process.env.EXPO_PUBLIC_SUPABASE_URL);
      console.log("ACCESS_TOKEN (mount, masked) =", maskToken(token));
      console.log("MAPS_AVAILABLE =", mapsAvailable, "Platform =", Platform.OS);
      console.log("I18N_LANGUAGE =", i18n.language);
      if (error) console.log("getSession error (mount) =", error.message);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

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
            "driver_id",
            "pickup_lat",
            "pickup_lng",
            "dropoff_lat",
            "dropoff_lng",
            "tip_cents",
            "client_user_id",
          ].join(",")
        )
        .eq("id", orderId)
        .single();

      if (error) throw error;

      const nextOrder = data as unknown as Order;

      if (isMountedRef.current) {
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
  }, [orderId, ts]);

  const fetchPaymentStatusOnly = useCallback(async () => {
    const { data, error } = await supabase.from("orders").select("payment_status").eq("id", orderId).single();
    if (error) throw error;
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
        console.log("load alreadyRated/tip error:", (e as any)?.message ?? e);
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
      while (isMountedRef.current && Date.now() - started < timeoutMs) {
        let status = "unpaid";

        try {
          status = await fetchPaymentStatusOnly();
          console.log("poll payment_status =", status);
        } catch (e) {
          console.log("poll payment_status error:", (e as any)?.message ?? e);
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

  async function handlePay() {
    if (!order?.id) return;

    const currentStatus = normalizePaymentStatus(order.payment_status);
    if (currentStatus === "paid") {
      Alert.alert(paymentTitle, ts("client.orderDetails.alreadyPaid", "Already paid ✅"));
      return;
    }

    try {
      setPaying(true);
      setPaymentPending(false);

      if (!API_URL) throw new Error("EXPO_PUBLIC_API_URL is missing");

      const { data, error } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;

      console.log("ACCESS_TOKEN (handlePay, masked) =", maskToken(accessToken));
      if (error) console.log("getSession error (handlePay) =", error.message);

      if (!accessToken) {
        throw new Error(ts("client.orderDetails.mustBeLoggedInToPay", "You must be logged in to pay."));
      }

      const endpoint = `${String(API_URL).replace(/\/$/, "")}/api/stripe/client/create-checkout-session`;

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

      await fetchOrder();

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
      setPaymentPending(false);
      Alert.alert(paymentTitle, e?.message ?? ts("client.orderDetails.paymentError", "Payment error."));
    } finally {
      if (isMountedRef.current) setPaying(false);
    }
  }

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
    payableAmount > 0 &&
    !loading &&
    !errorMsg &&
    !isPaid &&
    !paymentPending;

  const driverId = order?.driver_id ?? null;
  const { location: liveDriver } = useLiveDriverLocation(driverId);

  const pickupCoord = useMemo(() => {
    if (order?.pickup_lat == null || order?.pickup_lng == null) return null;
    return { latitude: Number(order.pickup_lat), longitude: Number(order.pickup_lng) };
  }, [order?.pickup_lat, order?.pickup_lng]);

  const dropoffCoord = useMemo(() => {
    if (order?.dropoff_lat == null || order?.dropoff_lng == null) return null;
    return { latitude: Number(order.dropoff_lat), longitude: Number(order.dropoff_lng) };
  }, [order?.dropoff_lat, order?.dropoff_lng]);

  const driverCoord = useMemo(() => {
    if (!liveDriver) return null;
    if (liveDriver.lat == null || liveDriver.lng == null) return null;
    return { latitude: Number(liveDriver.lat), longitude: Number(liveDriver.lng) };
  }, [liveDriver]);

  const polylineCoords = useMemo(() => {
    const coords: { latitude: number; longitude: number }[] = [];
    if (pickupCoord) coords.push(pickupCoord);
    if (dropoffCoord) coords.push(dropoffCoord);
    return coords;
  }, [pickupCoord, dropoffCoord]);

  const fallbackRegion = useMemo(() => {
    return {
      latitude: 40.650002,
      longitude: -73.949997,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }, []);

  const fitMapToTrip = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const pts: { latitude: number; longitude: number }[] = [];
    if (pickupCoord) pts.push(pickupCoord);
    if (dropoffCoord) pts.push(dropoffCoord);
    if (driverCoord) pts.push(driverCoord);

    if (pts.length >= 2 && typeof map.fitToCoordinates === "function") {
      map.fitToCoordinates(pts, {
        edgePadding: { top: 70, right: 70, bottom: 70, left: 70 },
        animated: true,
      });
      return;
    }

    const only = pts[0] ?? null;
    if (only && typeof map.animateToRegion === "function") {
      map.animateToRegion(
        {
          latitude: only.latitude,
          longitude: only.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        },
        600
      );
    }
  }, [pickupCoord, dropoffCoord, driverCoord]);

  useEffect(() => {
    if (!order) return;
    if (!mapsAvailable) return;
    if (didFitRef.current) return;

    if (pickupCoord || dropoffCoord || driverCoord) {
      const tt = setTimeout(() => {
        fitMapToTrip();
        didFitRef.current = true;
      }, 250);
      return () => clearTimeout(tt);
    }
  }, [order, pickupCoord, dropoffCoord, driverCoord, fitMapToTrip, mapsAvailable]);

  const MapViewComp: any = Maps?.default ?? null;
  const MarkerComp: any = (Maps as any)?.Marker ?? null;
  const PolylineComp: any = (Maps as any)?.Polyline ?? null;

  const meta = statusMeta(order?.status ?? "pending");
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
    try {
      const code = order?.dropoff_code ?? "";
      if (!code) return;

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
          <TouchableOpacity onPress={() => navigation.navigate("ClientHome")}>
            <Text style={{ color: "#60A5FA", fontSize: 13, fontWeight: "800" }}>
              ← {ts("client.orderDetails.backToClient", "Back to dashboard")}
            </Text>
          </TouchableOpacity>

          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: "white", fontSize: 20, fontWeight: "900" }}>
                {order ? meta.title : ts("client.orderDetails.loadingTitle", "Order")}
              </Text>

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
            </View>

            <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 6 }}>🕒 {createdCompact}</Text>

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
        </View>

        {!loading && !errorMsg && order && (pickupCoord || dropoffCoord) && (
          <>
            {mapsAvailable && MapViewComp ? (
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
                <MapViewComp
                  ref={(r: any) => (mapRef.current = r)}
                  style={{ flex: 1 }}
                  initialRegion={fallbackRegion}
                  onMapReady={() => {
                    if (!didFitRef.current) {
                      fitMapToTrip();
                      didFitRef.current = true;
                    }
                  }}
                >
                  {pickupCoord && MarkerComp && (
                    <MarkerComp
                      coordinate={pickupCoord}
                      title={ts("client.orderDetails.map.pickupTitle", "Pickup")}
                      description={order.pickup_address ?? undefined}
                    />
                  )}

                  {dropoffCoord && MarkerComp && (
                    <MarkerComp
                      coordinate={dropoffCoord}
                      title={ts("client.orderDetails.map.dropoffTitle", "Dropoff")}
                      description={order.dropoff_address ?? undefined}
                    />
                  )}

                  {driverCoord && MarkerComp && (
                    <MarkerComp
                      coordinate={driverCoord}
                      title={ts("client.orderDetails.map.driverTitle", "Driver")}
                      description={
                        liveDriver?.updated_at
                          ? `${ts("client.orderDetails.map.lastUpdate", "Last update:")} ${new Date(
                              liveDriver.updated_at
                            ).toLocaleTimeString()}`
                          : undefined
                      }
                    />
                  )}

                  {polylineCoords.length === 2 && PolylineComp && (
                    <>
                      <PolylineComp coordinates={polylineCoords} strokeWidth={8} strokeColor="rgba(59,130,246,0.18)" />
                      <PolylineComp coordinates={polylineCoords} strokeWidth={3} strokeColor="rgba(147,197,253,0.95)" />
                    </>
                  )}
                </MapViewComp>

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
                  </View>
                </View>
              </View>
            ) : (
              <View style={{ paddingHorizontal: 20, marginTop: 12 }}>
                <Card>
                  <Text style={{ color: "#FBBF24", fontWeight: "900" }}>
                    🗺️ {ts("client.orderDetails.mapUnavailableTitle", "Map unavailable")}
                  </Text>
                  <Text style={{ color: "#94A3B8", marginTop: 6, fontSize: 12, lineHeight: 16 }}>
                    {ts(
                      "client.orderDetails.mapUnavailableBody",
                      "You are probably on Expo Go. For react-native-maps, use a Dev Build (expo-dev-client / EAS)."
                    )}
                  </Text>
                </Card>
              </View>
            )}
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
                    try {
                      setSubmittingReview(true);

                      const { data: s } = await supabase.auth.getSession();
                      const uid = s.session?.user?.id;
                      if (!uid) throw new Error(ts("common.mustBeLoggedIn", "You must be logged in."));

                      if (order.client_user_id && uid !== order.client_user_id) {
                        throw new Error(
                          ts("client.orderDetails.notOwnerError", "You are not logged in as the order owner.") +
                            ` (auth=${uid} / owner=${order.client_user_id})`
                        );
                      }

                      const tipFromInput = parseMoneyToDollars(tipCustom);
                      const finalTipDollars = tipCustom.trim() ? tipFromInput : tipDollars;
                      const tip_cents = Math.max(0, Math.round((finalTipDollars || 0) * 100));

                      const { error: tipErr } = await supabase.from("orders").update({ tip_cents }).eq("id", order.id);
                      if (tipErr) throw tipErr;

                      const { error: ratingErr } = await supabase
                        .from("order_ratings")
                        .upsert(
                          {
                            order_id: order.id,
                            rater_id: uid,
                            rating,
                            comment: comment.trim() ? comment.trim() : null,
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
                      setSubmittingReview(false);
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
    </SafeAreaView>
  );
}