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
  Image,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";
import { formatMoney, formatDateTime as formatLocalizedDateTime } from "../i18n/formatters";
import { rowDirection, textAlignStart, mirrorChevron } from "../i18n/rtl";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_API_URL ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE_URL;

const AVATARS_BUCKET = "avatars";

function normalizeAvatarUrl(value: string | null | undefined) {
  const clean = String(value ?? "").trim();
  if (!clean) return null;

  if (/^https?:\/\//i.test(clean)) {
    return clean;
  }

  const { data } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(clean);
  return data?.publicUrl ?? null;
}

function getInitials(name: string | null | undefined, fallback = "D") {
  const clean = String(name ?? "").trim();
  if (!clean) return fallback;

  const parts = clean.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || fallback;
}

type DriverProfile = {
  full_name: string | null;
  avatar_url: string | null;
};

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
  driver_id: string | null;
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

function formatDistance(distance: number | null | undefined, dash: string) {
  if (typeof distance !== "number" || Number.isNaN(distance)) return dash;
  return `${distance.toFixed(1)} mi`;
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
  notAvailableLabel = "Not available yet",
}: {
  title: string;
  code: string | null;
  subtitle: string;
  accent: string;
  notAvailableLabel?: string;
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
          {code ?? notAvailableLabel}
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
    driver_id: request.driver_id,
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
  const { t, i18n } = useTranslation();
  const requestId = route?.params?.requestId as string | undefined;

  const dash = t("common.dash", "—");

  const formatCurrency = useCallback(
    (amount: number | null | undefined) => {
      if (typeof amount !== "number" || Number.isNaN(amount)) return dash;
      return formatMoney(amount, "USD", i18n.language);
    },
    [dash, i18n.language]
  );

  const formatDateTime = useCallback(
    (iso: string | null) => {
      if (!iso) return dash;
      return formatLocalizedDateTime(iso, i18n.language);
    },
    [dash, i18n.language]
  );

  const prettyStatus = useCallback(
    (status: string | null) => {
      if (status === "pending") return t("client.deliveryRequest.status.pending", "Pending");
      if (status === "accepted") return t("client.deliveryRequest.status.accepted", "Driver assigned");
      if (status === "prepared") return t("client.deliveryRequest.status.prepared", "Preparing pickup");
      if (status === "ready") return t("client.deliveryRequest.status.ready", "Ready for pickup");
      if (status === "dispatched") return t("client.deliveryRequest.status.dispatched", "On the way");
      if (status === "delivered") return t("client.deliveryRequest.status.delivered", "Delivered");
      if (status === "canceled") return t("client.deliveryRequest.status.canceled", "Canceled");
      return status ?? t("client.deliveryRequest.status.pending", "Pending");
    },
    [t]
  );

  const prettyPaymentStatus = useCallback(
    (status: string | null) => {
      if (status === "paid") return t("client.deliveryRequest.payment.paid", "Paid");
      if (status === "processing") return t("client.deliveryRequest.payment.processing", "Processing");
      if (status === "unpaid") return t("client.deliveryRequest.payment.unpaid", "Unpaid");
      return status ?? t("client.deliveryRequest.payment.unpaid", "Unpaid");
    },
    [t]
  );

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [data, setData] = useState<ScreenData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [driverProfile, setDriverProfile] = useState<DriverProfile | null>(null);

  const loadDetails = useCallback(
    async (options?: { silent?: boolean }) => {
      let alive = true;

      if (!requestId) {
        setError(t("client.deliveryRequest.missingRequestId", "Missing requestId."));
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
            stripe_payment_intent_id,
            driver_id
          `
          )
          .eq("id", requestId)
          .maybeSingle();

        if (requestError) throw requestError;
        if (!alive) return;

        if (!requestData) {
          setData(null);
          setError(t("client.deliveryRequest.notFound", "Delivery request not found."));
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
          driver_id: toSafeString(requestData.driver_id),
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
        setError(e?.message ?? t("client.deliveryRequest.loadError", "Unable to load delivery request."));
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
    [requestId, t]
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

  useEffect(() => {
    if (!requestId) return;

    const reload = () => {
      void loadDetails({ silent: true });
    };

    const channel = supabase
      .channel(`client-dr-detail:${requestId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "delivery_requests",
          filter: `id=eq.${requestId}`,
        },
        reload,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `id=eq.${requestId}`,
        },
        reload,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `external_ref_id=eq.${requestId}`,
        },
        reload,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [requestId, loadDetails]);

  useEffect(() => {
    let alive = true;

    (async () => {
      const driverId = data?.driver_id;
      if (!driverId) {
        setDriverProfile(null);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, avatar_url, role")
        .eq("id", driverId)
        .maybeSingle();

      if (!alive) return;

      if (profileError) {
        console.log("driver profile error (delivery request):", profileError.message);
        setDriverProfile(null);
        return;
      }

      setDriverProfile(
        profile
          ? {
              full_name: toSafeString(profile.full_name),
              avatar_url: toSafeString(profile.avatar_url),
            }
          : null
      );
    })();

    return () => {
      alive = false;
    };
  }, [data?.driver_id]);

  const primaryReference = useMemo(() => {
    if (data?.orderId) return shortRef(data.orderId);
    if (data?.requestId) return shortRef(data.requestId);
    return "";
  }, [data?.orderId, data?.requestId]);

  const title = useMemo(() => {
    if (!primaryReference) return t("client.deliveryRequest.title", "Delivery Request");
    return t("client.deliveryRequest.tripTitle", "🚗 Trip #{{ref}}", { ref: primaryReference });
  }, [primaryReference, t]);

  const driverState = useMemo(() => {
    if (!data?.driver_id) return t("client.deliveryRequest.waitingDriver", "Waiting for a driver");
    if (data.status === "accepted") return t("client.deliveryRequest.status.accepted", "Driver assigned");
    if (data.status === "prepared") return t("client.deliveryRequest.status.prepared", "Preparing pickup");
    if (data.status === "ready") return t("client.deliveryRequest.status.ready", "Ready for pickup");
    if (data.status === "dispatched") return t("client.deliveryRequest.driverOnWay", "Driver on the way");
    if (data.status === "delivered") return t("client.deliveryRequest.completed", "Completed");
    return t("client.deliveryRequest.status.accepted", "Driver assigned");
  }, [data?.driver_id, data?.status, t]);

  const codesAvailable = !!(data?.pickup_code || data?.dropoff_code);

  const canCancel = useMemo(() => {
    const status = normalizeStatus(data?.status);
    return !!data && (status === "pending" || status === "accepted") && !canceling;
  }, [data, canceling]);

  const driverAvatarUri = normalizeAvatarUrl(driverProfile?.avatar_url);
  const driverInitials = getInitials(driverProfile?.full_name, "D");
  const driverDisplayName =
    String(driverProfile?.full_name ?? "").trim() ||
    t("client.deliveryRequest.assignedDriver", "Assigned driver");

  async function handleCancelDeliveryRequest() {
    if (!data) return;

    const targetId = data.orderId || data.requestId;
    if (!targetId) return;

    const status = normalizeStatus(data.status);
    const cancelTitle = t("client.deliveryRequest.cancelTrip", "Cancel trip");

    if (!(status === "pending" || status === "accepted")) {
      Alert.alert(
        cancelTitle,
        t(
          "client.deliveryRequest.cancelNotAllowed",
          "This delivery can no longer be cancelled from this screen."
        )
      );
      return;
    }

    if (!API_URL) {
      Alert.alert(
        cancelTitle,
        t(
          "client.deliveryRequest.apiUrlMissing",
          "EXPO_PUBLIC_API_URL is missing. Set it to your web API URL."
        )
      );
      return;
    }

    const message =
      status === "pending"
        ? t(
            "client.deliveryRequest.cancelPendingMessage",
            "Because the trip is still pending, this cancellation should be eligible for a full refund review."
          )
        : t(
            "client.deliveryRequest.cancelAssignedMessage",
            "A driver or system may already be assigned. Cancelling now may not be refundable."
          );

    Alert.alert(cancelTitle, message, [
      {
        text: t("client.deliveryRequest.keepTrip", "Keep trip"),
        style: "cancel",
      },
      {
        text: cancelTitle,
        style: "destructive",
        onPress: async () => {
          try {
            setCanceling(true);

            const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
            if (sessionError) console.log("getSession error (cancel delivery request):", sessionError.message);

            const accessToken = sessionData.session?.access_token;
            if (!accessToken) {
              throw new Error(t("client.deliveryRequest.loginRequired", "You must be logged in."));
            }

            let out: CancelOrderResponse;

            if (data.orderId) {
              const endpoint = `${String(API_URL).replace(/\/$/, "")}/api/orders/cancel`;
              const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  orderId: data.orderId,
                  order_id: data.orderId,
                  role: "client",
                }),
              });
              out = (await res.json().catch(() => ({}))) as CancelOrderResponse;
              if (!res.ok || !out?.ok) {
                throw new Error(out?.error || `Cancel failed (${res.status})`);
              }
            } else {
              const { cancelDeliveryRequestAsClient } = await import(
                "../lib/deliveryRequestDriverApi"
              );
              out = (await cancelDeliveryRequestAsClient(data.requestId)) as CancelOrderResponse;
            }

            await loadDetails({ silent: true });

            Alert.alert(
              t("client.deliveryRequest.tripCancelled", "Trip cancelled"),
              out.refund === "FULL"
                ? t(
                    "client.deliveryRequest.refundFull",
                    "Cancellation completed. Refund status: full refund required."
                  )
                : t(
                    "client.deliveryRequest.refundNone",
                    "Cancellation completed. Refund status: no refund."
                  )
            );
          } catch (e: any) {
            Alert.alert(
              cancelTitle,
              e?.message ?? t("client.deliveryRequest.cancelFailed", "Unable to cancel this trip.")
            );
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
            {mirrorChevron("back")} {t("common.back", "Back")}
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
          {t(
            "client.deliveryRequest.subtitle",
            "Delivery request details, codes and tracking status"
          )}
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
            {t("client.deliveryRequest.loading", "Loading request...")}
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
            {t("client.deliveryRequest.loadFailedTitle", "Unable to load this request")}
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
            {t("client.deliveryRequest.noRequest", "No request found")}
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
              {t("client.deliveryRequest.currentStatus", "Current status")}
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
              {t("client.deliveryRequest.paymentStatus", "Payment status")}
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
              {t("client.deliveryRequest.driverStatus", "Driver status")}
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

            {data.driver_id ? (
              <View
                style={{
                  flexDirection: rowDirection(),
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 14,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.08)",
                  backgroundColor: "rgba(255,255,255,0.03)",
                  padding: 12,
                }}
              >
                {driverAvatarUri ? (
                  <Image
                    source={{ uri: driverAvatarUri }}
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      borderWidth: 1,
                      borderColor: "rgba(147,197,253,0.45)",
                      backgroundColor: "#0B1220",
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: 23,
                      borderWidth: 1,
                      borderColor: "rgba(147,197,253,0.45)",
                      backgroundColor: "rgba(15,23,42,0.95)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: "#E5E7EB", fontWeight: "900", fontSize: 13 }}>
                      {driverInitials}
                    </Text>
                  </View>
                )}

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: "#94A3B8",
                      fontSize: 12,
                      fontWeight: "700",
                      marginBottom: 4,
                    }}
                  >
                    {t("client.deliveryRequest.yourDriver", "Your driver")}
                  </Text>
                  <Text
                    style={{
                      color: "white",
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    {driverDisplayName}
                  </Text>
                </View>
              </View>
            ) : null}

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
                {t("client.deliveryRequest.tripReference", "Trip reference")}
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
                {t("client.deliveryRequest.requestReference", "Request reference")}
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
                    ❌ {t("client.deliveryRequest.cancelTrip", "Cancel trip")}
                  </Text>
                )}
              </TouchableOpacity>
              <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 9, lineHeight: 17 }}>
                {normalizeStatus(data.status) === "pending"
                  ? t(
                      "client.deliveryRequest.cancelPendingHint",
                      "You can cancel while this trip is still pending."
                    )
                  : t(
                      "client.deliveryRequest.cancelAssignedHint",
                      "Cancelling after assignment may not be refundable."
                    )}
              </Text>
            </View>
          )}

          <CodeCard
            title={t("client.deliveryRequest.pickupCode", "Pickup code")}
            code={data.pickup_code}
            subtitle={
              codesAvailable
                ? t(
                    "client.deliveryRequest.pickupCodeHint",
                    "Give this code to the person handing the package to the driver. The driver will need this code + a pickup photo to confirm collection."
                  )
                : t(
                    "client.deliveryRequest.pickupCodePending",
                    "The pickup code will appear here as soon as the linked delivery order is available."
                  )
            }
            accent="rgba(96,165,250,0.45)"
            notAvailableLabel={t("client.deliveryRequest.notAvailableYet", "Not available yet")}
          />

          <CodeCard
            title={t("client.deliveryRequest.dropoffCode", "Dropoff code")}
            code={data.dropoff_code}
            subtitle={
              codesAvailable
                ? t(
                    "client.deliveryRequest.dropoffCodeHint",
                    "Share this code with the recipient. The driver will need this code + a delivery photo to confirm dropoff."
                  )
                : t(
                    "client.deliveryRequest.dropoffCodePending",
                    "The dropoff code will appear here as soon as the linked delivery order is available."
                  )
            }
            accent="rgba(52,211,153,0.45)"
            notAvailableLabel={t("client.deliveryRequest.notAvailableYet", "Not available yet")}
          />

          <InfoCard label={t("client.deliveryRequest.pickupAddress", "Pickup address")} value={data.pickup_address ?? dash} />
          <InfoCard label={t("client.deliveryRequest.dropoffAddress", "Dropoff address")} value={data.dropoff_address ?? dash} />

          <View style={{ flexDirection: rowDirection(), gap: 10, marginBottom: 2 }}>
            <View style={{ flex: 1 }}>
              <InfoCard
                label={t("client.deliveryRequest.distance", "Distance")}
                value={formatDistance(data.distance_miles, dash)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <InfoCard
                label={t("client.deliveryRequest.deliveryFee", "Delivery fee")}
                value={formatCurrency(data.delivery_fee)}
              />
            </View>
          </View>

          <InfoCard label={t("client.deliveryRequest.total", "Total")} value={formatCurrency(data.total)} />
          <InfoCard label={t("client.deliveryRequest.createdAt", "Created at")} value={formatDateTime(data.created_at)} />
          <InfoCard label={t("client.deliveryRequest.updatedAt", "Updated at")} value={formatDateTime(data.updated_at)} />
          <InfoCard label={t("client.deliveryRequest.paidAt", "Paid at")} value={formatDateTime(data.paid_at)} />
          <InfoCard label={t("client.deliveryRequest.pickedUpAt", "Picked up at")} value={formatDateTime(data.picked_up_at)} />
          <InfoCard
            label={t("client.deliveryRequest.deliveredAt", "Delivered confirmed at")}
            value={formatDateTime(data.delivered_confirmed_at)}
          />

          <InfoCard
            label={t("client.deliveryRequest.pickupPhoto", "Pickup proof photo")}
            value={
              data.pickup_photo_url
                ? t("client.deliveryRequest.saved", "Saved")
                : t("client.deliveryRequest.notUploaded", "Not uploaded yet")
            }
            valueColor={data.pickup_photo_url ? "#86EFAC" : "#CBD5E1"}
          />
          <InfoCard
            label={t("client.deliveryRequest.dropoffPhoto", "Dropoff proof photo")}
            value={
              data.dropoff_photo_url
                ? t("client.deliveryRequest.saved", "Saved")
                : t("client.deliveryRequest.notUploaded", "Not uploaded yet")
            }
            valueColor={data.dropoff_photo_url ? "#86EFAC" : "#CBD5E1"}
          />

          <InfoCard
            label={t("client.deliveryRequest.stripeSession", "Stripe session ID")}
            value={data.stripe_session_id ?? dash}
          />
          <InfoCard
            label={t("client.deliveryRequest.stripePaymentIntent", "Stripe payment intent ID")}
            value={data.stripe_payment_intent_id ?? dash}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default ClientDeliveryRequestDetailsScreen;
