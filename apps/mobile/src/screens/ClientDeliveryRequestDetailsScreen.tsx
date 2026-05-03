import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE_URL;

type DeliveryRequestRecord = {
  id: string;
  status: string | null;
  payment_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

type OrderRecord = {
  id: string;
  kind: string | null;
  status: string | null;
  payment_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  pickup_code: string | null;
  dropoff_code: string | null;
  picked_up_at: string | null;
  delivered_confirmed_at: string | null;
  pickup_photo_url: string | null;
  dropoff_photo_url: string | null;
  driver_id: string | null;
  external_ref_id: string | null;
  external_ref_type: string | null;
};

type ScreenData = {
  source: "order" | "delivery_request" | "linked_order_and_request";
  requestId: string;
  orderId: string | null;
  kind: string | null;
  status: string | null;
  payment_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  pickup_code: string | null;
  dropoff_code: string | null;
  picked_up_at: string | null;
  delivered_confirmed_at: string | null;
  pickup_photo_url: string | null;
  dropoff_photo_url: string | null;
  driver_id: string | null;
};

type CancelOrderResponse = {
  ok?: boolean;
  cancelled?: boolean;
  by?: string;
  refund?: "FULL" | "NONE" | string;
  error?: string;
};

function toSafeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toSafeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && !Number.isNaN(Number(value))
    ? Number(value)
    : null;
}

function formatCurrency(amount: number | null | undefined) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDistance(distance: number | null | undefined) {
  if (typeof distance !== "number" || Number.isNaN(distance)) return "—";
  return `${distance.toFixed(1)} mi`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function normalizeKind(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function shortRef(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 8);
}

function statusColor(status: string | null) {
  if (status === "delivered") return "#86EFAC";
  if (status === "canceled") return "#FCA5A5";
  if (status === "dispatched") return "#93C5FD";
  if (status === "accepted") return "#BFDBFE";
  return "#CBD5E1";
}

function paymentColor(status: string | null) {
  if (status === "paid") return "#86EFAC";
  if (status === "processing") return "#FDE68A";
  if (status === "unpaid") return "#FCA5A5";
  return "#CBD5E1";
}

function prettyStatus(status: string | null) {
  if (status === "pending") return "Pending";
  if (status === "accepted") return "Driver assigned";
  if (status === "prepared") return "Preparing pickup";
  if (status === "ready") return "Ready for pickup";
  if (status === "dispatched") return "On the way";
  if (status === "delivered") return "Delivered";
  if (status === "canceled") return "Canceled";
  return status ?? "pending";
}

function prettyPaymentStatus(status: string | null) {
  if (status === "paid") return "Paid";
  if (status === "processing") return "Processing";
  if (status === "unpaid") return "Unpaid";
  return status ?? "unpaid";
}

function InfoCard({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <View
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(15,23,42,0.92)",
        padding: 14,
        marginBottom: 12,
      }}
    >
      <Text
        style={{
          color: "#94A3B8",
          fontSize: 12,
          fontWeight: "700",
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: valueColor ?? "white",
          fontSize: 15,
          fontWeight: "800",
        }}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

function CodeCard({
  title,
  code,
  subtitle,
  accent,
}: {
  title: string;
  code: string | null;
  subtitle: string;
  accent: string;
}) {
  return (
    <View
      style={{
        borderRadius: 20,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(15,23,42,0.96)",
        padding: 16,
        marginBottom: 12,
      }}
    >
      <Text
        style={{
          color: "#E2E8F0",
          fontSize: 15,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        {title}
      </Text>

      <View
        style={{
          borderRadius: 16,
          borderWidth: 1,
          borderColor: accent,
          backgroundColor: "rgba(255,255,255,0.03)",
          paddingVertical: 14,
          paddingHorizontal: 14,
          marginBottom: 10,
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: code ? "white" : "#94A3B8",
            fontSize: code ? 26 : 15,
            fontWeight: "900",
            letterSpacing: code ? 2 : 0,
          }}
        >
          {code ?? "Not available yet"}
        </Text>
      </View>

      <Text
        style={{
          color: "#94A3B8",
          fontSize: 13,
          lineHeight: 19,
        }}
      >
        {subtitle}
      </Text>
    </View>
  );
}

function mapDeliveryRequestToScreenData(
  request: DeliveryRequestRecord
): ScreenData {
  return {
    source: "delivery_request",
    requestId: request.id,
    orderId: null,
    kind: "delivery_request",
    status: request.status,
    payment_status: request.payment_status,
    created_at: request.created_at,
    updated_at: request.updated_at,
    paid_at: request.paid_at,
    pickup_address: request.pickup_address,
    dropoff_address: request.dropoff_address,
    distance_miles: request.distance_miles,
    total: request.total,
    delivery_fee: request.delivery_fee,
    stripe_session_id: request.stripe_session_id,
    stripe_payment_intent_id: request.stripe_payment_intent_id,
    pickup_code: null,
    dropoff_code: null,
    picked_up_at: null,
    delivered_confirmed_at: null,
    pickup_photo_url: null,
    dropoff_photo_url: null,
    driver_id: null,
  };
}

function mapOrderToScreenData(
  order: OrderRecord,
  requestIdFallback?: string | null
): ScreenData {
  return {
    source: requestIdFallback ? "linked_order_and_request" : "order",
    requestId: requestIdFallback ?? order.id,
    orderId: order.id,
    kind: order.kind,
    status: order.status,
    payment_status: order.payment_status,
    created_at: order.created_at,
    updated_at: order.updated_at,
    paid_at: order.paid_at,
    pickup_address: order.pickup_address,
    dropoff_address: order.dropoff_address,
    distance_miles: order.distance_miles,
    total: order.total,
    delivery_fee: order.delivery_fee,
    stripe_session_id: order.stripe_session_id,
    stripe_payment_intent_id: order.stripe_payment_intent_id,
    pickup_code: order.pickup_code,
    dropoff_code: order.dropoff_code,
    picked_up_at: order.picked_up_at,
    delivered_confirmed_at: order.delivered_confirmed_at,
    pickup_photo_url: order.pickup_photo_url,
    dropoff_photo_url: order.dropoff_photo_url,
    driver_id: order.driver_id,
  };
}

export function ClientDeliveryRequestDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const requestId = route?.params?.requestId as string | undefined;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [data, setData] = useState<ScreenData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDetails = useCallback(
    async (options?: { silent?: boolean }) => {
      let alive = true;

      if (!requestId) {
        setError("Missing requestId.");
        setLoading(false);
        return () => {
          alive = false;
        };
      }

      try {
        if (options?.silent) setRefreshing(true);
        else setLoading(true);
        setError(null);

        const { data: directOrder, error: directOrderError } = await supabase
          .from("orders")
          .select(
            `
            id,
            kind,
            status,
            payment_status,
            created_at,
            updated_at,
            paid_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total,
            delivery_fee,
            stripe_session_id,
            stripe_payment_intent_id,
            pickup_code,
            dropoff_code,
            picked_up_at,
            delivered_confirmed_at,
            pickup_photo_url,
            dropoff_photo_url,
            driver_id,
            external_ref_id,
            external_ref_type
          `
          )
          .eq("id", requestId)
          .maybeSingle();

        if (directOrderError) throw directOrderError;
        if (!alive) return;

        if (directOrder) {
          const kind = normalizeKind(directOrder.kind);
          if (kind === "pickup_dropoff") {
            setData(
              mapOrderToScreenData({
                id: String(directOrder.id),
                kind: toSafeString(directOrder.kind),
                status: toSafeString(directOrder.status),
                payment_status: toSafeString(directOrder.payment_status),
                created_at: toSafeString(directOrder.created_at),
                updated_at: toSafeString(directOrder.updated_at),
                paid_at: toSafeString(directOrder.paid_at),
                pickup_address: toSafeString(directOrder.pickup_address),
                dropoff_address: toSafeString(directOrder.dropoff_address),
                distance_miles: toSafeNumber(directOrder.distance_miles),
                total: toSafeNumber(directOrder.total),
                delivery_fee: toSafeNumber(directOrder.delivery_fee),
                stripe_session_id: toSafeString(directOrder.stripe_session_id),
                stripe_payment_intent_id: toSafeString(
                  directOrder.stripe_payment_intent_id
                ),
                pickup_code: toSafeString(directOrder.pickup_code),
                dropoff_code: toSafeString(directOrder.dropoff_code),
                picked_up_at: toSafeString(directOrder.picked_up_at),
                delivered_confirmed_at: toSafeString(
                  directOrder.delivered_confirmed_at
                ),
                pickup_photo_url: toSafeString(directOrder.pickup_photo_url),
                dropoff_photo_url: toSafeString(directOrder.dropoff_photo_url),
                driver_id: toSafeString(directOrder.driver_id),
                external_ref_id: toSafeString(directOrder.external_ref_id),
                external_ref_type: toSafeString(directOrder.external_ref_type),
              })
            );
            return;
          }
        }

        const { data: requestData, error: requestError } = await supabase
          .from("delivery_requests")
          .select(
            `
            id,
            status,
            payment_status,
            created_at,
            updated_at,
            paid_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total,
            delivery_fee,
            stripe_session_id,
            stripe_payment_intent_id
          `
          )
          .eq("id", requestId)
          .maybeSingle();

        if (requestError) throw requestError;
        if (!alive) return;

        if (!requestData) {
          setData(null);
          setError("Delivery request not found.");
          return;
        }

        const normalizedRequest: DeliveryRequestRecord = {
          id: String(requestData.id),
          status: toSafeString(requestData.status),
          payment_status: toSafeString(requestData.payment_status),
          created_at: toSafeString(requestData.created_at),
          updated_at: toSafeString(requestData.updated_at),
          paid_at: toSafeString(requestData.paid_at),
          pickup_address: toSafeString(requestData.pickup_address),
          dropoff_address: toSafeString(requestData.dropoff_address),
          distance_miles: toSafeNumber(requestData.distance_miles),
          total: toSafeNumber(requestData.total),
          delivery_fee: toSafeNumber(requestData.delivery_fee),
          stripe_session_id: toSafeString(requestData.stripe_session_id),
          stripe_payment_intent_id: toSafeString(
            requestData.stripe_payment_intent_id
          ),
        };

        const { data: linkedOrder, error: linkedOrderError } = await supabase
          .from("orders")
          .select(
            `
            id,
            kind,
            status,
            payment_status,
            created_at,
            updated_at,
            paid_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total,
            delivery_fee,
            stripe_session_id,
            stripe_payment_intent_id,
            pickup_code,
            dropoff_code,
            picked_up_at,
            delivered_confirmed_at,
            pickup_photo_url,
            dropoff_photo_url,
            driver_id,
            external_ref_id,
            external_ref_type
          `
          )
          .eq("external_ref_id", requestId)
          .maybeSingle();

        if (linkedOrderError) throw linkedOrderError;
        if (!alive) return;

        if (linkedOrder && normalizeKind(linkedOrder.kind) === "pickup_dropoff") {
          setData(
            mapOrderToScreenData(
              {
                id: String(linkedOrder.id),
                kind: toSafeString(linkedOrder.kind),
                status: toSafeString(linkedOrder.status),
                payment_status: toSafeString(linkedOrder.payment_status),
                created_at: toSafeString(linkedOrder.created_at),
                updated_at: toSafeString(linkedOrder.updated_at),
                paid_at: toSafeString(linkedOrder.paid_at),
                pickup_address: toSafeString(linkedOrder.pickup_address),
                dropoff_address: toSafeString(linkedOrder.dropoff_address),
                distance_miles: toSafeNumber(linkedOrder.distance_miles),
                total: toSafeNumber(linkedOrder.total),
                delivery_fee: toSafeNumber(linkedOrder.delivery_fee),
                stripe_session_id: toSafeString(linkedOrder.stripe_session_id),
                stripe_payment_intent_id: toSafeString(
                  linkedOrder.stripe_payment_intent_id
                ),
                pickup_code: toSafeString(linkedOrder.pickup_code),
                dropoff_code: toSafeString(linkedOrder.dropoff_code),
                picked_up_at: toSafeString(linkedOrder.picked_up_at),
                delivered_confirmed_at: toSafeString(
                  linkedOrder.delivered_confirmed_at
                ),
                pickup_photo_url: toSafeString(linkedOrder.pickup_photo_url),
                dropoff_photo_url: toSafeString(linkedOrder.dropoff_photo_url),
                driver_id: toSafeString(linkedOrder.driver_id),
                external_ref_id: toSafeString(linkedOrder.external_ref_id),
                external_ref_type: toSafeString(linkedOrder.external_ref_type),
              },
              normalizedRequest.id
            )
          );
          return;
        }

        setData(mapDeliveryRequestToScreenData(normalizedRequest));
      } catch (e: any) {
        if (!alive) return;
        console.log("load delivery request details error:", e);
        setError(e?.message ?? "Unable to load delivery request.");
      } finally {
        if (alive) {
          setLoading(false);
          setRefreshing(false);
        }
      }

      return () => {
        alive = false;
      };
    },
    [requestId]
  );

  useEffect(() => {
    let cleanup: void | (() => void);

    (async () => {
      cleanup = await loadDetails();
    })();

    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, [loadDetails]);

  const primaryReference = useMemo(() => {
    if (data?.orderId) return shortRef(data.orderId);
    if (data?.requestId) return shortRef(data.requestId);
    return "";
  }, [data?.orderId, data?.requestId]);

  const title = useMemo(() => {
    if (!primaryReference) return "Delivery Request";
    return `🚗 Trip #${primaryReference}`;
  }, [primaryReference]);

  const driverState = useMemo(() => {
    if (!data?.driver_id) return "Waiting for a driver";
    if (data.status === "accepted") return "Driver assigned";
    if (data.status === "prepared") return "Preparing pickup";
    if (data.status === "ready") return "Ready for pickup";
    if (data.status === "dispatched") return "Driver on the way";
    if (data.status === "delivered") return "Completed";
    return "Driver assigned";
  }, [data?.driver_id, data?.status]);

  const codesAvailable = !!(data?.pickup_code || data?.dropoff_code);

  const canCancel = useMemo(() => {
    const status = normalizeStatus(data?.status);
    return !!data && (status === "pending" || status === "accepted") && !canceling;
  }, [data, canceling]);

  async function handleCancelDeliveryRequest() {
    if (!data) return;

    const targetId = data.orderId || data.requestId;
    if (!targetId) return;

    const status = normalizeStatus(data.status);
    if (!(status === "pending" || status === "accepted")) {
      Alert.alert("Cancel trip", "This delivery can no longer be cancelled from this screen.");
      return;
    }

    if (!API_URL) {
      Alert.alert("Cancel trip", "EXPO_PUBLIC_API_URL is missing. Set it to your web API URL.");
      return;
    }

    const message =
      status === "pending"
        ? "Because the trip is still pending, this cancellation should be eligible for a full refund review."
        : "A driver or system may already be assigned. Cancelling now may not be refundable.";

    Alert.alert("Cancel trip", message, [
      {
        text: "Keep trip",
        style: "cancel",
      },
      {
        text: "Cancel trip",
        style: "destructive",
        onPress: async () => {
          try {
            setCanceling(true);

            const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) console.log("getSession error (cancel delivery request):", sessionError.message);

            const accessToken = sessionData.session?.access_token;
            if (!accessToken) {
              throw new Error("You must be logged in.");
            }

            const endpoint = `${String(API_URL).replace(/\/$/, "")}/api/orders/cancel`;

            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify({
                orderId: targetId,
                order_id: targetId,
                role: "client",
              }),
            });

            const out = (await res.json().catch(() => ({}))) as CancelOrderResponse;

            if (!res.ok || !out?.ok) {
              throw new Error(out?.error || `Cancel failed (${res.status})`);
            }

            await loadDetails({ silent: true });

            Alert.alert(
              "Trip cancelled",
              out.refund === "FULL"
                ? "Cancellation completed. Refund status: full refund required."
                : "Cancellation completed. Refund status: no refund."
            );
          } catch (e: any) {
            Alert.alert("Cancel trip", e?.message ?? "Unable to cancel this trip.");
          } finally {
            setCanceling(false);
          }
        },
      },
    ]);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030617" }}>
      <StatusBar barStyle="light-content" />

      <View
        style={{
          paddingHorizontal: 18,
          paddingTop: 16,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.06)",
          backgroundColor: "#030617",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text
            style={{
              color: "#93C5FD",
              fontSize: 14,
              fontWeight: "800",
              marginBottom: 10,
            }}
          >
            ← Back
          </Text>
        </TouchableOpacity>

        <Text
          style={{
            color: "white",
            fontSize: 22,
            fontWeight: "900",
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            color: "#94A3B8",
            marginTop: 6,
            fontSize: 13,
          }}
        >
          Delivery request details, codes and tracking status
        </Text>
      </View>

      {loading ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator color="white" />
          <Text style={{ color: "#94A3B8", marginTop: 12 }}>
            Loading request...
          </Text>
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <Text
            style={{
              color: "#FCA5A5",
              fontSize: 15,
              fontWeight: "800",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Unable to load this request
          </Text>
          <Text
            style={{
              color: "#94A3B8",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
        </View>
      ) : !data ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "800" }}>
            No request found
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 18,
            paddingBottom: 36,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              backgroundColor: "rgba(15,23,42,0.96)",
              padding: 16,
              marginBottom: 14,
            }}
          >
            <Text
              style={{
                color: "#94A3B8",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Current status
            </Text>
            <Text
              style={{
                color: statusColor(data.status),
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 14,
              }}
            >
              {prettyStatus(data.status)}
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Payment status
            </Text>
            <Text
              style={{
                color: paymentColor(data.payment_status),
                fontSize: 16,
                fontWeight: "900",
                marginBottom: 14,
              }}
            >
              {prettyPaymentStatus(data.payment_status)}
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Driver status
            </Text>
            <Text
              style={{
                color: "#E2E8F0",
                fontSize: 15,
                fontWeight: "800",
                marginBottom: 14,
              }}
            >
              {driverState}
            </Text>

            <View
              style={{
                borderRadius: 18,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
                backgroundColor: "rgba(255,255,255,0.03)",
                padding: 14,
              }}
            >
              <Text
                style={{
                  color: "#94A3B8",
                  fontSize: 12,
                  fontWeight: "700",
                  marginBottom: 6,
                }}
              >
                Trip reference
              </Text>
              <Text
                style={{
                  color: "white",
                  fontSize: 18,
                  fontWeight: "900",
                  marginBottom: 12,
                }}
              >
                #{shortRef(data.orderId ?? data.requestId)}
              </Text>

              <Text
                style={{
                  color: "#94A3B8",
                  fontSize: 12,
                  fontWeight: "700",
                  marginBottom: 6,
                }}
              >
                Request reference
              </Text>
              <Text
                style={{
                  color: "#CBD5E1",
                  fontSize: 14,
                  fontWeight: "800",
                }}
              >
                #{shortRef(data.requestId)}
              </Text>
            </View>
          </View>

          {canCancel && (
            <View style={{ marginBottom: 14 }}>
              <TouchableOpacity
                onPress={handleCancelDeliveryRequest}
                disabled={canceling || refreshing}
                activeOpacity={0.85}
                style={{
                  backgroundColor: canceling ? "rgba(148,163,184,0.18)" : "rgba(248,113,113,0.92)",
                  paddingVertical: 15,
                  borderRadius: 16,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: canceling ? "rgba(148,163,184,0.18)" : "rgba(248,113,113,0.35)",
                }}
              >
                {canceling ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={{ color: "white", fontWeight: "900", fontSize: 15 }}>
                    ❌ Cancel trip
                  </Text>
                )}
              </TouchableOpacity>
              <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 9, lineHeight: 17 }}>
                {normalizeStatus(data.status) === "pending"
                  ? "You can cancel while this trip is still pending."
                  : "Cancelling after assignment may not be refundable."}
              </Text>
            </View>
          )}

          <CodeCard
            title="Pickup code"
            code={data.pickup_code}
            subtitle={
              codesAvailable
                ? "Give this code to the person handing the package to the driver. The driver will need this code + a pickup photo to confirm collection."
                : "The pickup code will appear here as soon as the linked delivery order is available."
            }
            accent="rgba(96,165,250,0.45)"
          />

          <CodeCard
            title="Dropoff code"
            code={data.dropoff_code}
            subtitle={
              codesAvailable
                ? "Share this code with the recipient. The driver will need this code + a delivery photo to confirm dropoff."
                : "The dropoff code will appear here as soon as the linked delivery order is available."
            }
            accent="rgba(52,211,153,0.45)"
          />

          <InfoCard label="Pickup address" value={data.pickup_address ?? "—"} />
          <InfoCard label="Dropoff address" value={data.dropoff_address ?? "—"} />

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 2 }}>
            <View style={{ flex: 1 }}>
              <InfoCard
                label="Distance"
                value={formatDistance(data.distance_miles)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <InfoCard
                label="Delivery fee"
                value={formatCurrency(data.delivery_fee)}
              />
            </View>
          </View>

          <InfoCard label="Total" value={formatCurrency(data.total)} />
          <InfoCard label="Created at" value={formatDateTime(data.created_at)} />
          <InfoCard label="Updated at" value={formatDateTime(data.updated_at)} />
          <InfoCard label="Paid at" value={formatDateTime(data.paid_at)} />
          <InfoCard label="Picked up at" value={formatDateTime(data.picked_up_at)} />
          <InfoCard
            label="Delivered confirmed at"
            value={formatDateTime(data.delivered_confirmed_at)}
          />

          <InfoCard
            label="Pickup proof photo"
            value={data.pickup_photo_url ? "Saved" : "Not uploaded yet"}
            valueColor={data.pickup_photo_url ? "#86EFAC" : "#CBD5E1"}
          />
          <InfoCard
            label="Dropoff proof photo"
            value={data.dropoff_photo_url ? "Saved" : "Not uploaded yet"}
            valueColor={data.dropoff_photo_url ? "#86EFAC" : "#CBD5E1"}
          />

          <InfoCard
            label="Stripe session ID"
            value={data.stripe_session_id ?? "—"}
          />
          <InfoCard
            label="Stripe payment intent ID"
            value={data.stripe_payment_intent_id ?? "—"}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default ClientDeliveryRequestDetailsScreen;
