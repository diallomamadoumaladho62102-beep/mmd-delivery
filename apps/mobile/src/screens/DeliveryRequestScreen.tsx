import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { API_BASE_URL } from "../lib/apiBase";
import { startCheckoutForDeliveryRequest } from "../utils/stripe";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type RequestType = "package" | "ride";

type ApiDeliveryPrice = {
  deliveryFee: number;
  platformFee?: number;
  driverPayout?: number;
};

type ApiCoords = {
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
};

type MapboxDistanceResponse = {
  ok?: boolean;
  error?: string;
  message?: string;

  distanceMiles?: number;
  distance_miles?: number;
  distance_miles_est?: number;

  etaMinutes?: number;
  eta_minutes?: number;
  eta_minutes_est?: number;

  deliveryPrice?: ApiDeliveryPrice;
  delivery_fee?: ApiDeliveryPrice;
  delivery_fee_usd?: ApiDeliveryPrice;

  pickupLat?: number;
  pickupLng?: number;
  pickupLon?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  dropoffLon?: number;

  pickup_lat?: number;
  pickup_lng?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;

  coords?: (ApiCoords & {
    pickupLon?: number;
    dropoffLon?: number;
  }) & {
    pickup_lat?: number;
    pickup_lng?: number;
    dropoff_lat?: number;
    dropoff_lng?: number;
  };

  raw?: {
    distance_meters: number;
    duration_seconds: number;
  };
};

type LatLng = {
  lat: number;
  lng: number;
};

type PricingConfigRow = {
  delivery_fee_base: number | null;
  delivery_fee_per_mile: number | null;
  delivery_fee_per_minute: number | null;
  currency: string | null;
};

type DeliveryRequestRow = {
  id: string;
  created_by: string | null;
  client_user_id: string | null;
  payment_status: string | null;
  paid_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  distance_miles: number | null;
  delivery_fee: number | null;
  total: number | null;
};

function cents(value: number) {
  return Math.round(value * 100);
}

function cleanText(value: string) {
  return value.trim();
}

function normalizeAddress(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function looksLikeCompleteAddress(value: string) {
  const v = normalizeAddress(value);
  return v.length >= 8;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function toSafeMoney(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return roundMoney(value);
}

function money(value: number | null, currency = "USD") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} ${currency}`;
}

function getFriendlyEstimateError(message?: string) {
  const msg = (message ?? "").trim();
  if (!msg) {
    return "Unable to calculate delivery estimate right now.";
  }

  const lower = msg.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("network request failed") ||
    lower.includes("network")
  ) {
    return "Network error while calculating the estimate.";
  }

  if (lower.includes("timeout") || lower.includes("aborted")) {
    return "Estimate request timed out. Please try again.";
  }

  if (lower.includes("distance too far")) {
    return "Distance too large. Please verify both addresses.";
  }

  if (lower.includes("route exceeds maximum distance limitation")) {
    return "Distance too large or address not precise enough. Please verify street, ZIP code, city, and state.";
  }

  return msg;
}

function computeDeliveryPricingFromConfig(
  distanceMiles: number,
  durationMinutes: number,
  pricing: PricingConfigRow | null
) {
  const baseFare = toSafeMoney(pricing?.delivery_fee_base);
  const perMile = toSafeMoney(pricing?.delivery_fee_per_mile);
  const perMinute = toSafeMoney(pricing?.delivery_fee_per_minute);

  const raw = baseFare + distanceMiles * perMile + durationMinutes * perMinute;
  return roundMoney(raw);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function DeliveryRequestScreen() {
  const navigation = useNavigation<Nav>();

  const [requestType, setRequestType] = useState<RequestType>("package");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [pickupContactName, setPickupContactName] = useState("");
  const [pickupPhone, setPickupPhone] = useState("");
  const [dropoffContactName, setDropoffContactName] = useState("");
  const [dropoffPhone, setDropoffPhone] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [pickupCoords, setPickupCoords] = useState<LatLng | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<LatLng | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [pricingConfig, setPricingConfig] = useState<PricingConfigRow | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);

  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);

  const autoEstimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEstimateRequestIdRef = useRef<number>(0);
  const lastEstimateKeyRef = useRef<string>("");

  const subtotal = 0;
  const tax = 0;
  const currency = pricingConfig?.currency || "USD";

  const total = useMemo(() => {
    const fee = toSafeMoney(deliveryFee ?? 0);
    return roundMoney(subtotal + tax + fee);
  }, [deliveryFee]);

  const estimateReady = useMemo(() => {
    return (
      distanceMiles != null &&
      etaMinutes != null &&
      deliveryFee != null &&
      Number.isFinite(distanceMiles) &&
      Number.isFinite(etaMinutes) &&
      Number.isFinite(deliveryFee)
    );
  }, [distanceMiles, etaMinutes, deliveryFee]);

  const canPay = useMemo(() => {
    return Boolean(lastCreatedId) && !submitting && !estimating && !pricingLoading && !paying;
  }, [lastCreatedId, submitting, estimating, pricingLoading, paying]);

  const requestCardStyle = (active: boolean) => ({
    backgroundColor: active ? "rgba(37,99,235,0.20)" : "#0F172A",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: active
      ? "rgba(96,165,250,0.40)"
      : "rgba(255,255,255,0.08)",
  });

  const inputStyle = {
    backgroundColor: "#0F172A",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    color: "white" as const,
    fontSize: 15,
  };

  const resetEstimateState = useCallback(() => {
    setDistanceMiles(null);
    setEtaMinutes(null);
    setDeliveryFee(null);
    setPickupCoords(null);
    setDropoffCoords(null);
    setEstimateError(null);
  }, []);

  const loadPricingConfig = useCallback(async () => {
    try {
      setPricingLoading(true);

      const { data, error } = await supabase
        .from("pricing_config")
        .select("delivery_fee_base, delivery_fee_per_mile, delivery_fee_per_minute, currency")
        .eq("config_key", "errand_default")
        .eq("order_type", "errand")
        .eq("active", true)
        .maybeSingle();

      if (error) throw error;

      setPricingConfig((data as PricingConfigRow | null) ?? null);
    } catch (e) {
      console.error("loadPricingConfig error:", e);
      setPricingConfig(null);
    } finally {
      setPricingLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPricingConfig();
  }, [loadPricingConfig]);

  const validate = useCallback(() => {
    const pickup = normalizeAddress(pickupAddress);
    const dropoff = normalizeAddress(dropoffAddress);

    if (!pickup) {
      Alert.alert("Missing pickup", "Please enter the pickup address.");
      return false;
    }

    if (!dropoff) {
      Alert.alert("Missing dropoff", "Please enter the dropoff address.");
      return false;
    }

    if (!looksLikeCompleteAddress(pickup) || !looksLikeCompleteAddress(dropoff)) {
      Alert.alert("Incomplete address", "Please enter complete pickup and dropoff addresses.");
      return false;
    }

    if (requestType === "package" && !cleanText(description)) {
      Alert.alert("Missing description", "Please describe what needs to be delivered.");
      return false;
    }

    return true;
  }, [pickupAddress, dropoffAddress, requestType, description]);

  const handleEstimate = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      const pickupValue = normalizeAddress(pickupAddress);
      const dropoffValue = normalizeAddress(dropoffAddress);

      if (!pickupValue || !dropoffValue) {
        resetEstimateState();
        if (!silent) {
          Alert.alert("Missing fields", "Please fill in both pickup and dropoff addresses first.");
        }
        return false;
      }

      if (!looksLikeCompleteAddress(pickupValue) || !looksLikeCompleteAddress(dropoffValue)) {
        resetEstimateState();
        if (!silent) {
          Alert.alert("Incomplete address", "Please enter complete pickup and dropoff addresses.");
        }
        return false;
      }

      if (!API_BASE_URL) {
        resetEstimateState();
        if (!silent) {
          Alert.alert(
            "Missing configuration",
            "API_BASE_URL is not configured. Add EXPO_PUBLIC_WEB_BASE_URL or EXPO_PUBLIC_API_URL."
          );
        }
        return false;
      }

      const requestId = Date.now();
      activeEstimateRequestIdRef.current = requestId;

      let timeout: ReturnType<typeof setTimeout> | null = null;

      try {
        setEstimating(true);
        setEstimateError(null);

        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 20000);

        const url = `${API_BASE_URL}/api/mapbox/compute-distance`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pickupAddress: pickupValue,
            dropoffAddress: dropoffValue,
          }),
          signal: controller.signal,
        });

        const rawText = await res.text();
        let json: MapboxDistanceResponse | null = null;

        try {
          json = rawText ? (JSON.parse(rawText) as MapboxDistanceResponse) : null;
        } catch {
          json = null;
        }

        if (activeEstimateRequestIdRef.current !== requestId) {
          return false;
        }

        if (!res.ok || !json || json.ok === false) {
          const friendly = getFriendlyEstimateError(
            json?.message ?? json?.error ?? rawText ?? `HTTP ${res.status}`
          );
          resetEstimateState();
          setEstimateError(friendly);
          if (!silent) {
            Alert.alert("Estimate failed", friendly);
          }
          return false;
        }

        const dMiles =
          json.distanceMiles ??
          json.distance_miles ??
          json.distance_miles_est ??
          undefined;

        const tMinutes =
          json.etaMinutes ??
          json.eta_minutes ??
          json.eta_minutes_est ??
          undefined;

        if (
          typeof dMiles !== "number" ||
          Number.isNaN(dMiles) ||
          typeof tMinutes !== "number" ||
          Number.isNaN(tMinutes)
        ) {
          const friendly = "Invalid distance/time response from the estimate API.";
          resetEstimateState();
          setEstimateError(friendly);
          if (!silent) {
            Alert.alert("Estimate failed", friendly);
          }
          return false;
        }

        const pLat =
          json.pickupLat ??
          json.pickup_lat ??
          json.coords?.pickupLat ??
          json.coords?.pickup_lat ??
          undefined;

        const pLng =
          json.pickupLng ??
          json.pickupLon ??
          json.pickup_lng ??
          json.coords?.pickupLng ??
          json.coords?.pickupLon ??
          json.coords?.pickup_lng ??
          undefined;

        const dLat =
          json.dropoffLat ??
          json.dropoff_lat ??
          json.coords?.dropoffLat ??
          json.coords?.dropoff_lat ??
          undefined;

        const dLng =
          json.dropoffLng ??
          json.dropoffLon ??
          json.dropoff_lng ??
          json.coords?.dropoffLng ??
          json.coords?.dropoffLon ??
          json.coords?.dropoff_lng ??
          undefined;

        const feeFromApi =
          json.delivery_fee_usd?.deliveryFee ??
          json.deliveryPrice?.deliveryFee ??
          json.delivery_fee?.deliveryFee ??
          undefined;

        const feeLocal = computeDeliveryPricingFromConfig(dMiles, tMinutes, pricingConfig);

        const finalFee =
          typeof feeFromApi === "number" && !Number.isNaN(feeFromApi)
            ? roundMoney(feeFromApi)
            : roundMoney(feeLocal);

        setDistanceMiles(dMiles);
        setEtaMinutes(tMinutes);
        setDeliveryFee(finalFee);

        if (
          typeof pLat === "number" &&
          typeof pLng === "number" &&
          !Number.isNaN(pLat) &&
          !Number.isNaN(pLng)
        ) {
          setPickupCoords({ lat: pLat, lng: pLng });
        } else {
          setPickupCoords(null);
        }

        if (
          typeof dLat === "number" &&
          typeof dLng === "number" &&
          !Number.isNaN(dLat) &&
          !Number.isNaN(dLng)
        ) {
          setDropoffCoords({ lat: dLat, lng: dLng });
        } else {
          setDropoffCoords(null);
        }

        setEstimateError(null);
        return true;
      } catch (e: unknown) {
        if (activeEstimateRequestIdRef.current !== requestId) {
          return false;
        }

        const friendly = getFriendlyEstimateError(
          e instanceof Error ? e.message : "Unable to calculate estimate."
        );

        resetEstimateState();
        setEstimateError(friendly);

        if (!silent) {
          Alert.alert("Estimate failed", friendly);
        }

        return false;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }

        if (activeEstimateRequestIdRef.current === requestId) {
          setEstimating(false);
        }
      }
    },
    [pickupAddress, dropoffAddress, resetEstimateState, pricingConfig]
  );

  useEffect(() => {
    if (autoEstimateTimerRef.current) {
      clearTimeout(autoEstimateTimerRef.current);
    }

    const pickupValue = normalizeAddress(pickupAddress);
    const dropoffValue = normalizeAddress(dropoffAddress);

    if (!looksLikeCompleteAddress(pickupValue) || !looksLikeCompleteAddress(dropoffValue)) {
      if (!pickupValue || !dropoffValue) {
        resetEstimateState();
      }
      return;
    }

    const estimateKey = `${pickupValue}__${dropoffValue}`;
    if (lastEstimateKeyRef.current === estimateKey) {
      return;
    }

    autoEstimateTimerRef.current = setTimeout(() => {
      void handleEstimate({ silent: true }).then((ok) => {
        if (ok) {
          lastEstimateKeyRef.current = estimateKey;
        }
      });
    }, 700);

    return () => {
      if (autoEstimateTimerRef.current) {
        clearTimeout(autoEstimateTimerRef.current);
      }
    };
  }, [pickupAddress, dropoffAddress, handleEstimate, resetEstimateState]);

  const waitForDeliveryPayment = useCallback(async (deliveryId: string) => {
    const maxAttempts = 15;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const { data, error } = await supabase
        .from("delivery_requests")
        .select("payment_status, paid_at")
        .eq("id", deliveryId)
        .single();

      if (error) {
        throw error;
      }

      const paymentStatus = String(data?.payment_status ?? "").toLowerCase();

      if (paymentStatus === "paid") {
        return true;
      }

      await sleep(2000);
    }

    return false;
  }, []);

  const createOrderFromPaidDeliveryRequest = useCallback(
    async (deliveryId: string, userId: string) => {
      const { data: existingOrder, error: existingOrderError } = await supabase
        .from("orders")
        .select("id")
        .eq("external_ref_id", deliveryId)
        .eq("external_ref_type", "delivery_request")
        .maybeSingle();

      if (existingOrderError) {
        throw existingOrderError;
      }

      if (existingOrder?.id) {
        return String(existingOrder.id);
      }

      const { data: deliveryData, error: deliveryReadError } = await supabase
        .from("delivery_requests")
        .select(
          [
            "id",
            "created_by",
            "client_user_id",
            "payment_status",
            "paid_at",
            "pickup_address",
            "dropoff_address",
            "pickup_lat",
            "pickup_lng",
            "dropoff_lat",
            "dropoff_lng",
            "distance_miles",
            "delivery_fee",
            "total",
          ].join(", ")
        )
        .eq("id", deliveryId)
        .single();

      if (deliveryReadError) {
        throw deliveryReadError;
      }

      const delivery = (deliveryData ?? null) as unknown as DeliveryRequestRow | null;

      if (!delivery?.id) {
        throw new Error("Delivery request not found after payment.");
      }

      if (delivery.payment_status !== "paid") {
        throw new Error("Payment has not been confirmed yet.");
      }

      const nowIso = new Date().toISOString();

      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .insert({
          kind: "pickup_dropoff",
          status: "pending",
          payment_status: "paid",
          paid_at: delivery.paid_at ?? nowIso,
          driver_id: null,

          created_by: delivery.created_by ?? userId,
          client_user_id: delivery.client_user_id ?? userId,

          pickup_address: delivery.pickup_address,
          dropoff_address: delivery.dropoff_address,

          pickup_lat: delivery.pickup_lat,
          pickup_lng: delivery.pickup_lng,
          dropoff_lat: delivery.dropoff_lat,
          dropoff_lng: delivery.dropoff_lng,

          distance_miles: delivery.distance_miles,
          delivery_fee: delivery.delivery_fee,
          total: delivery.total,

          external_ref_id: delivery.id,
          external_ref_type: "delivery_request",

          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .single();

      if (orderError) {
        console.error("❌ order insert error:", orderError);
        throw new Error(orderError.message || "Failed to create order");
      }

      return String(orderData?.id ?? "");
    },
    []
  );

  const handleCreateRequest = useCallback(async () => {
    if (submitting) return;
    if (!validate()) return;

    if (!estimateReady) {
      const ok = await handleEstimate({ silent: false });
      if (!ok) return;
    }

    setSubmitting(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) throw sessionError;

      const user = sessionData?.session?.user;
      if (!user) {
        throw new Error("You must be logged in to create a delivery request.");
      }

      const safePickup = normalizeAddress(pickupAddress);
      const safeDropoff = normalizeAddress(dropoffAddress);
      const safePickupContactName = cleanText(pickupContactName);
      const safePickupPhone = cleanText(pickupPhone);
      const safeDropoffContactName = cleanText(dropoffContactName);
      const safeDropoffPhone = cleanText(dropoffPhone);

      const safeTitle =
        cleanText(title) ||
        (requestType === "ride" ? "Private ride request" : "Package delivery");

      const safeDescription = cleanText(description);

      const safeFee = toSafeMoney(deliveryFee);
      const safeTotal = roundMoney(subtotal + tax + safeFee);

      const { data: deliveryData, error: deliveryError } = await supabase
        .from("delivery_requests")
        .insert({
          created_by: user.id,
          client_user_id: user.id,
          status: "pending",
          payment_status: "unpaid",

          kind: "delivery",
          request_type: requestType,

          title: safeTitle,
          errand_description: safeDescription || null,

          pickup_address: safePickup,
          dropoff_address: safeDropoff,

          pickup_contact_name: safePickupContactName || null,
          pickup_phone: safePickupPhone || null,
          dropoff_contact_name: safeDropoffContactName || null,
          dropoff_phone: safeDropoffPhone || null,

          pickup_lat: pickupCoords?.lat ?? null,
          pickup_lng: pickupCoords?.lng ?? null,
          dropoff_lat: dropoffCoords?.lat ?? null,
          dropoff_lng: dropoffCoords?.lng ?? null,

          distance_miles: distanceMiles,
          eta_minutes: etaMinutes != null ? Math.round(etaMinutes) : null,

          subtotal,
          delivery_fee: safeFee,
          tax,
          total: safeTotal,

          subtotal_cents: cents(subtotal),
          delivery_fee_cents: cents(safeFee),
          tax_cents: cents(tax),
          total_cents: cents(safeTotal),

          currency,
        })
        .select("id")
        .single();

      if (deliveryError) throw deliveryError;

      const deliveryId = String(deliveryData?.id ?? "").trim();
      if (!deliveryId) {
        throw new Error("Delivery request created without a valid id.");
      }

      setLastCreatedId(deliveryId);

      Alert.alert(
        "Success",
        "Delivery request created. Tap Pay now to complete payment."
      );

      console.log("delivery_requests created:", deliveryId);
    } catch (e: unknown) {
      console.error("❌ create request error:", e);
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to create request");
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    validate,
    estimateReady,
    handleEstimate,
    pickupAddress,
    dropoffAddress,
    pickupContactName,
    pickupPhone,
    dropoffContactName,
    dropoffPhone,
    title,
    description,
    requestType,
    deliveryFee,
    distanceMiles,
    etaMinutes,
    pickupCoords,
    dropoffCoords,
    currency,
  ]);

  const handlePay = useCallback(async () => {
    if (paying) return;

    try {
      if (!lastCreatedId) {
        Alert.alert("Payment", "Create the delivery request first.");
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const user = sessionData?.session?.user;
      const accessToken = sessionData?.session?.access_token;

      if (!user || !accessToken) {
        throw new Error("You must be logged in to pay.");
      }

      setPaying(true);

      await startCheckoutForDeliveryRequest(lastCreatedId, accessToken);

      const paid = await waitForDeliveryPayment(lastCreatedId);

      if (!paid) {
        Alert.alert(
          "Payment pending",
          "Payment was started, but confirmation is still pending. The driver will not see the order until payment is confirmed."
        );
        return;
      }

      const orderId = await createOrderFromPaidDeliveryRequest(lastCreatedId, user.id);

      Alert.alert(
        "Payment successful",
        orderId
          ? "Your payment is confirmed and the order is now visible for driver dispatch."
          : "Your payment is confirmed."
      );
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : "Unable to start payment right now.";
      Alert.alert("Payment error", message);
    } finally {
      setPaying(false);
    }
  }, [lastCreatedId, paying, createOrderFromPaidDeliveryRequest, waitForDeliveryPayment]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: 32,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={{ marginBottom: 26 }}>
            <Text style={{ fontSize: 40, marginBottom: 10 }}>🚀</Text>

            <Text
              style={{
                color: "white",
                fontSize: 30,
                fontWeight: "900",
                marginBottom: 6,
              }}
            >
              Request a Delivery
            </Text>

            <Text
              style={{
                color: "#CBD5E1",
                fontSize: 16,
                lineHeight: 22,
              }}
            >
              Create a package delivery or private ride request without using the
              restaurant flow.
            </Text>
          </View>

          <View style={{ marginBottom: 20 }}>
            <Text
              style={{
                color: "white",
                fontSize: 16,
                fontWeight: "800",
                marginBottom: 12,
              }}
            >
              Choose request type
            </Text>

            <View style={{ gap: 14 }}>
              <TouchableOpacity
                activeOpacity={0.9}
                style={requestCardStyle(requestType === "package")}
                onPress={() => setRequestType("package")}
              >
                <Text style={{ fontSize: 28, marginBottom: 8 }}>📦</Text>

                <Text
                  style={{
                    color: "white",
                    fontSize: 18,
                    fontWeight: "800",
                    marginBottom: 4,
                  }}
                >
                  Send a Package
                </Text>

                <Text style={{ color: "#94A3B8", fontSize: 14 }}>
                  Deliver documents, parcels or personal items.
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                style={requestCardStyle(requestType === "ride")}
                onPress={() => setRequestType("ride")}
              >
                <Text style={{ fontSize: 28, marginBottom: 8 }}>🚗</Text>

                <Text
                  style={{
                    color: "white",
                    fontSize: 18,
                    fontWeight: "800",
                    marginBottom: 4,
                  }}
                >
                  Request a Ride
                </Text>

                <Text style={{ color: "#94A3B8", fontSize: 14 }}>
                  Book a private driver directly.
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View
            style={{
              borderRadius: 20,
              backgroundColor: "#081121",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              padding: 16,
              marginBottom: 20,
            }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 16,
                fontWeight: "800",
                marginBottom: 14,
              }}
            >
              Request details
            </Text>

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              Title
            </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={
                requestType === "ride"
                  ? "Example: Airport ride"
                  : "Example: Important documents"
              }
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              Pickup address
            </Text>
            <TextInput
              value={pickupAddress}
              onChangeText={(value) => {
                setPickupAddress(value);
                lastEstimateKeyRef.current = "";
              }}
              placeholder="Enter pickup address"
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              Dropoff address
            </Text>
            <TextInput
              value={dropoffAddress}
              onChangeText={(value) => {
                setDropoffAddress(value);
                lastEstimateKeyRef.current = "";
              }}
              placeholder="Enter dropoff address"
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              Pickup contact name
            </Text>
            <TextInput
              value={pickupContactName}
              onChangeText={setPickupContactName}
              placeholder="Optional"
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              Pickup phone
            </Text>
            <TextInput
              value={pickupPhone}
              onChangeText={setPickupPhone}
              placeholder="Optional"
              placeholderTextColor="#64748B"
              keyboardType="phone-pad"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              Dropoff contact name
            </Text>
            <TextInput
              value={dropoffContactName}
              onChangeText={setDropoffContactName}
              placeholder="Optional"
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              Dropoff phone
            </Text>
            <TextInput
              value={dropoffPhone}
              onChangeText={setDropoffPhone}
              placeholder="Optional"
              placeholderTextColor="#64748B"
              keyboardType="phone-pad"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              {requestType === "ride" ? "Ride notes" : "Package description"}
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={
                requestType === "ride"
                  ? "Optional ride notes"
                  : "Describe the package"
              }
              placeholderTextColor="#64748B"
              multiline
              textAlignVertical="top"
              style={[
                inputStyle,
                {
                  minHeight: 110,
                  marginBottom: 4,
                },
              ]}
            />
          </View>

          <View
            style={{
              borderRadius: 20,
              backgroundColor: "#0F172A",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              padding: 18,
              marginBottom: 18,
            }}
          >
            <Text
              style={{
                color: "white",
                fontSize: 16,
                fontWeight: "800",
                marginBottom: 10,
              }}
            >
              Pricing snapshot
            </Text>

            {pricingLoading ? (
              <Text style={{ color: "#93C5FD", fontSize: 14 }}>
                Loading admin pricing...
              </Text>
            ) : estimating ? (
              <Text style={{ color: "#93C5FD", fontSize: 14 }}>
                Calculating delivery estimate...
              </Text>
            ) : estimateError ? (
              <Text style={{ color: "#FCA5A5", fontSize: 14, lineHeight: 21 }}>
                {estimateError}
              </Text>
            ) : estimateReady ? (
              <>
                <Text style={{ color: "#86EFAC", fontSize: 14, fontWeight: "800" }}>
                  Estimate ready.
                </Text>

                <View style={{ height: 10 }} />

                <Text style={{ color: "#CBD5E1", fontSize: 14 }}>
                  Distance:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {distanceMiles != null ? `${distanceMiles.toFixed(2)} mi` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#CBD5E1", fontSize: 14, marginTop: 6 }}>
                  ETA:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {etaMinutes != null ? `${Math.round(etaMinutes)} min` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#CBD5E1", fontSize: 14, marginTop: 6 }}>
                  Delivery fee:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {money(deliveryFee, currency)}
                  </Text>
                </Text>

                <Text style={{ color: "#CBD5E1", fontSize: 14, marginTop: 6 }}>
                  Tax:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {money(tax, currency)}
                  </Text>
                </Text>

                <Text style={{ color: "#CBD5E1", fontSize: 14, marginTop: 6 }}>
                  Total:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {money(total, currency)}
                  </Text>
                </Text>

                <Text style={{ color: "#64748B", fontSize: 12, marginTop: 12 }}>
                  Pickup GPS:{" "}
                  {pickupCoords
                    ? `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}`
                    : "—"}
                </Text>

                <Text style={{ color: "#64748B", fontSize: 12, marginTop: 4 }}>
                  Dropoff GPS:{" "}
                  {dropoffCoords
                    ? `${dropoffCoords.lat.toFixed(5)}, ${dropoffCoords.lng.toFixed(5)}`
                    : "—"}
                </Text>
              </>
            ) : (
              <Text style={{ color: "#94A3B8", fontSize: 14, lineHeight: 22 }}>
                Enter complete pickup and dropoff addresses. The estimate will be
                calculated automatically using admin pricing from pricing_config.
              </Text>
            )}
          </View>

          {lastCreatedId ? (
            <View
              style={{
                borderRadius: 16,
                backgroundColor: "rgba(34,197,94,0.12)",
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.28)",
                padding: 14,
                marginBottom: 14,
              }}
            >
              <Text style={{ color: "#86EFAC", fontSize: 14, fontWeight: "800" }}>
                Delivery request created
              </Text>
              <Text style={{ color: "#D1FAE5", fontSize: 13, marginTop: 6 }}>
                ID: {lastCreatedId.slice(0, 8)}
              </Text>
              <Text style={{ color: "#D1FAE5", fontSize: 13, marginTop: 6 }}>
                You can now continue to secure payment.
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            onPress={() => void handleEstimate({ silent: false })}
            activeOpacity={0.9}
            disabled={estimating || submitting || pricingLoading || paying}
            style={{
              backgroundColor:
                estimating || submitting || pricingLoading || paying
                  ? "#475569"
                  : "#1D4ED8",
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
              minHeight: 56,
            }}
          >
            {estimating ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={{
                  color: "white",
                  fontSize: 17,
                  fontWeight: "800",
                }}
              >
                Calculate delivery price
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleCreateRequest}
            activeOpacity={0.9}
            disabled={submitting || estimating || pricingLoading || paying}
            style={{
              backgroundColor:
                submitting || estimating || pricingLoading || paying
                  ? "#64748B"
                  : "#2563EB",
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
              minHeight: 56,
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={{
                  color: "white",
                  fontSize: 18,
                  fontWeight: "800",
                }}
              >
                Create delivery request
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handlePay}
            activeOpacity={0.9}
            disabled={!canPay}
            style={{
              backgroundColor: !canPay ? "#64748B" : "#22C55E",
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
              minHeight: 56,
            }}
          >
            {paying ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text
                style={{
                  color: "white",
                  fontSize: 18,
                  fontWeight: "800",
                }}
              >
                Pay now
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
            disabled={submitting || estimating || paying}
            style={{
              backgroundColor: "#FACC15",
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: "#111827",
                fontSize: 18,
                fontWeight: "800",
              }}
            >
              Back
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default DeliveryRequestScreen;