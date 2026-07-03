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
  Switch,
} from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { API_BASE_URL } from "../lib/apiBase";
import { fetchMapboxComputeDistance } from "../lib/mapboxComputeDistance";
import { startCheckoutForDeliveryRequest } from "../utils/stripe";
import { PaymentMethodPicker } from "../components/PaymentMethodPicker";
import { type PaymentMethodOption } from "../lib/paymentMethodsApi";
import {
  loadLocalPaymentMethods,
  shouldOfferLocalMobileMoney,
  startLocalPaymentForMethod,
} from "../lib/localPayments";
import { fetchMmdLocation } from "../lib/mmdLocationApi";
import {
  applyMmdLocationSelection,
  useMmdLocationPickerResult,
} from "../lib/useMmdLocationPickerResult";
import { useTranslation } from "react-i18next";
import { useClientPlatformFeatures } from "../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../lib/marketScope";
import {
  createDeliveryRequest,
  quoteDeliveryRequest,
  syncPaidDeliveryRequestOrder,
  type DeliveryRequestPricingPayload,
} from "../lib/deliveryRequestApi";

type Nav = NativeStackNavigationProp<RootStackParamList>;
type DeliveryRequestRoute = RouteProp<RootStackParamList, "DeliveryRequest">;

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

function getFriendlyEstimateError(message: string | undefined, tr: (key: string, fallback: string) => string) {
  const msg = (message ?? "").trim();
  if (!msg) {
    return tr("deliveryRequest.errors.estimateGeneric", "Impossible de calculer l’estimation de livraison pour le moment.");
  }

  const lower = msg.toLowerCase();

  if (
    lower.includes("failed to fetch") ||
    lower.includes("network request failed") ||
    lower.includes("network")
  ) {
    return tr("deliveryRequest.errors.networkEstimate", "Erreur réseau pendant le calcul de l’estimation.");
  }

  if (lower.includes("timeout") || lower.includes("aborted")) {
    return tr("deliveryRequest.errors.estimateTimeout", "La demande d’estimation a pris trop de temps. Réessaie.");
  }

  if (lower.includes("distance too far")) {
    return tr("deliveryRequest.errors.distanceTooLarge", "Distance trop grande. Vérifie les deux adresses.");
  }

  if (lower.includes("route exceeds maximum distance limitation")) {
    return tr("deliveryRequest.errors.distanceTooLargeOrImprecise", "Distance trop grande ou adresse pas assez précise. Vérifie la rue, le ZIP code, la ville et l’État.");
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
  const route = useRoute<DeliveryRequestRoute>();
  const { t } = useTranslation();

  const tr = useCallback(
    (key: string, fallback: string) => String(t(key, { defaultValue: fallback })),
    [t]
  );

  const { features: platformFeatures } = useClientPlatformFeatures();
  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );

  const [requestType, setRequestType] = useState<RequestType>("package");
  const [pickupAddress, setPickupAddress] = useState("");
  const [dropoffAddress, setDropoffAddress] = useState("");
  const [leaveAtDoor, setLeaveAtDoor] = useState(false);
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
  const [dropoffLocationId, setDropoffLocationId] = useState<string | null>(
    route.params?.dropoffLocationId ?? null
  );
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [pricingConfig, setPricingConfig] = useState<PricingConfigRow | null>(null);
  const [pricingLoading, setPricingLoading] = useState(true);

  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);
  const [paymentPickerVisible, setPaymentPickerVisible] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [loadingPaymentMethods, setLoadingPaymentMethods] = useState(false);
  const [lastCreatedId, setLastCreatedId] = useState<string | null>(null);
  const [serverPricing, setServerPricing] = useState<DeliveryRequestPricingPayload | null>(null);

  const autoEstimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEstimateRequestIdRef = useRef<number>(0);
  const lastEstimateKeyRef = useRef<string>("");

  const subtotal = serverPricing?.subtotal ?? 0;
  const tax = serverPricing?.tax ?? 0;
  const serviceFee = serverPricing?.service_fee ?? 0;
  const displayDeliveryFee = serverPricing?.delivery_fee ?? deliveryFee;
  const displayGrandTotal =
    serverPricing?.total ??
    roundMoney(
      subtotal + tax + toSafeMoney(displayDeliveryFee ?? 0) + toSafeMoney(serviceFee)
    );
  const currency =
    pricingConfig?.currency ||
    (market.scopeResolved ? market.currencyCode : "USD");

  const deliveryBlocked = market.scopeResolved && !market.deliveryAvailable;
  const deliveryBlockedMessage =
    platformFeatures.message ??
    tr(
      "deliveryRequest.errors.unavailableInArea",
      "MMD delivery is not available in your current area."
    );

  const total = useMemo(() => displayGrandTotal, [displayGrandTotal]);

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

  useEffect(() => {
    const locationId = dropoffLocationId?.trim();
    if (!locationId) return;

    void fetchMmdLocation(locationId)
      .then((location) => {
        if (!location) return;
        setDropoffAddress((prev) => prev || location.address || location.directions_text);
        setDropoffCoords({
          lat: location.pin_lat,
          lng: location.pin_lng,
        });
      })
      .catch((e) => {
        console.warn("dropoff location preload failed:", e);
      });
  }, [dropoffLocationId]);

  const handleDropoffLocation = useCallback(
    (location: Parameters<typeof applyMmdLocationSelection>[0]) => {
      applyMmdLocationSelection(location, {
        setLocationId: (id) => setDropoffLocationId(id),
        setAddress: (value) => {
          setDropoffAddress(value);
          lastEstimateKeyRef.current = "";
        },
        setCoords: setDropoffCoords,
      });
    },
    []
  );

  useMmdLocationPickerResult(route, navigation, {
    delivery_dropoff: handleDropoffLocation,
  });

  function openDropoffLocationPicker() {
    if (!market.countryCode) {
      Alert.alert(
        tr("deliveryRequest.alerts.scopeTitle", "Market unavailable"),
        tr(
          "deliveryRequest.alerts.scopeBody",
          "Enable location to pick a delivery address in your market."
        )
      );
      return;
    }

    navigation.navigate("MMDLocationPicker", {
      countryCode: market.countryCode,
      title: tr("deliveryRequest.fields.dropoffExactLocation", "Dropoff exact location"),
      submitLabel: tr("deliveryRequest.fields.useDropoffLocation", "Use dropoff location"),
      returnTo: "DeliveryRequest",
      pickerContext: "delivery_dropoff",
    });
  }

  const validate = useCallback(() => {
    const pickup = normalizeAddress(pickupAddress);
    const dropoff = normalizeAddress(dropoffAddress);

    if (!pickup) {
      Alert.alert(tr("deliveryRequest.alerts.missingPickupTitle", "Pickup manquant"), tr("deliveryRequest.alerts.missingPickupBody", "Entre l’adresse pickup."));
      return false;
    }

    if (!dropoff && !dropoffLocationId) {
      Alert.alert(tr("deliveryRequest.alerts.missingDropoffTitle", "Dropoff manquant"), tr("deliveryRequest.alerts.missingDropoffBody", "Entre l’adresse dropoff."));
      return false;
    }

    if (!looksLikeCompleteAddress(pickup)) {
      Alert.alert(tr("deliveryRequest.alerts.incompleteAddressTitle", "Adresse incomplète"), tr("deliveryRequest.alerts.incompleteAddressBody", "Entre des adresses pickup et dropoff complètes."));
      return false;
    }

    const dropoffOk = dropoffLocationId
      ? Boolean(dropoffCoords)
      : looksLikeCompleteAddress(dropoff);
    if (!dropoffOk) {
      Alert.alert(tr("deliveryRequest.alerts.incompleteAddressTitle", "Adresse incomplète"), tr("deliveryRequest.alerts.incompleteAddressBody", "Entre des adresses pickup et dropoff complètes."));
      return false;
    }

    if (requestType === "package" && !cleanText(description)) {
      Alert.alert(tr("deliveryRequest.alerts.missingDescriptionTitle", "Description manquante"), tr("deliveryRequest.alerts.missingDescriptionBody", "Décris ce qui doit être livré."));
      return false;
    }

    return true;
  }, [pickupAddress, dropoffAddress, dropoffLocationId, dropoffCoords, requestType, description, tr]);

  const handleEstimate = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = options?.silent === true;
      const pickupValue = normalizeAddress(pickupAddress);
      const dropoffValue = normalizeAddress(dropoffAddress);

      if (!pickupValue || !dropoffValue) {
        resetEstimateState();
        if (!silent) {
          Alert.alert(tr("deliveryRequest.alerts.missingFieldsTitle", "Champs manquants"), tr("deliveryRequest.alerts.missingFieldsBody", "Remplis d’abord les adresses pickup et dropoff."));
        }
        return false;
      }

      if (!looksLikeCompleteAddress(pickupValue) || !looksLikeCompleteAddress(dropoffValue)) {
        resetEstimateState();
        if (!silent) {
          Alert.alert(tr("deliveryRequest.alerts.incompleteAddressTitle", "Adresse incomplète"), tr("deliveryRequest.alerts.incompleteAddressBody", "Entre des adresses pickup et dropoff complètes."));
        }
        return false;
      }

      if (!API_BASE_URL) {
        resetEstimateState();
        if (!silent) {
          Alert.alert(
            tr("deliveryRequest.alerts.missingConfigTitle", "Configuration manquante"),
            tr("deliveryRequest.alerts.missingConfigBody", "API_BASE_URL n’est pas configurée. Ajoute EXPO_PUBLIC_WEB_BASE_URL ou EXPO_PUBLIC_API_URL.")
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

        const res = await fetchMapboxComputeDistance({
          apiBaseUrl: API_BASE_URL,
          body: {
            pickupAddress: pickupValue,
            dropoffAddress: dropoffValue,
          },
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
            json?.message ?? json?.error ?? rawText ?? `HTTP ${res.status}`,
            tr
          );
          resetEstimateState();
          setEstimateError(friendly);
          if (!silent) {
            Alert.alert(tr("deliveryRequest.alerts.estimateFailedTitle", "Estimation échouée"), friendly);
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
          const friendly = tr("deliveryRequest.errors.invalidDistanceTime", "Réponse distance/temps invalide depuis l’API d’estimation.");
          resetEstimateState();
          setEstimateError(friendly);
          if (!silent) {
            Alert.alert(tr("deliveryRequest.alerts.estimateFailedTitle", "Estimation échouée"), friendly);
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
          e instanceof Error ? e.message : tr("deliveryRequest.errors.estimateGeneric", "Impossible de calculer l’estimation."),
          tr
        );

        resetEstimateState();
        setEstimateError(friendly);

        if (!silent) {
          Alert.alert(tr("deliveryRequest.alerts.estimateFailedTitle", "Estimation échouée"), friendly);
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
    [pickupAddress, dropoffAddress, resetEstimateState, pricingConfig, tr]
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
    async (deliveryId: string, _userId: string) => {
      return syncPaidDeliveryRequestOrder(deliveryId, {
        countryCode: market.countryCode,
        lat: dropoffCoords?.lat,
        lng: dropoffCoords?.lng,
      });
    },
    [market.countryCode, dropoffCoords]
  );

  const handleCreateRequest = useCallback(async () => {
    if (submitting) return;
    if (deliveryBlocked) {
      Alert.alert(
        tr("common.error.title", "Erreur"),
        deliveryBlockedMessage
      );
      return;
    }
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
        throw new Error(tr("deliveryRequest.errors.loginRequiredCreate", "Tu dois être connecté pour créer une demande de livraison."));
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

      if (!pickupCoords || !dropoffCoords) {
        throw new Error(
          tr(
            "deliveryRequest.errors.missingCoords",
            "Merci de refaire l’estimation pour récupérer les coordonnées GPS."
          )
        );
      }

      const { deliveryRequestId, pricing } = await createDeliveryRequest(
        {
          request_type: requestType,
          title: safeTitle,
          description: safeDescription || null,
          pickup_address: safePickup,
          dropoff_address: safeDropoff,
          pickup_contact_name: safePickupContactName || null,
          pickup_phone: safePickupPhone || null,
          dropoff_contact_name: safeDropoffContactName || null,
          dropoff_phone: safeDropoffPhone || null,
          pickup_lat: pickupCoords.lat,
          pickup_lng: pickupCoords.lng,
          dropoff_lat: dropoffCoords.lat,
          dropoff_lng: dropoffCoords.lng,
          dropoff_location_id: dropoffLocationId,
          leave_at_door: requestType === "package" ? leaveAtDoor : false,
        },
        {
          countryCode: market.countryCode,
          lat: dropoffCoords.lat,
          lng: dropoffCoords.lng,
        }
      );

      setServerPricing(pricing);
      setDeliveryFee(roundMoney(pricing.delivery_fee));
      setLastCreatedId(deliveryRequestId);

      Alert.alert(
        tr("deliveryRequest.alerts.createdTitle", "Demande créée ✅"),
        tr("deliveryRequest.alerts.createdBody", "Demande de livraison créée. Appuie sur Payer maintenant pour finaliser le paiement.")
      );

      console.log("delivery_requests created:", deliveryRequestId);
    } catch (e: unknown) {
      console.error("❌ create request error:", e);
      Alert.alert(tr("common.error", "Erreur"), e instanceof Error ? e.message : tr("deliveryRequest.errors.createFailed", "Impossible de créer la demande."));
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    deliveryBlocked,
    deliveryBlockedMessage,
    tr,
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
        Alert.alert(tr("deliveryRequest.payment.title", "Paiement"), tr("deliveryRequest.payment.createFirst", "Crée d’abord la demande de livraison."));
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw sessionError;
      }

      const user = sessionData?.session?.user;
      const accessToken = sessionData?.session?.access_token;

      if (!user || !accessToken) {
        throw new Error(tr("deliveryRequest.errors.loginRequiredPay", "Tu dois être connecté pour payer."));
      }

      if (market.countryCode && shouldOfferLocalMobileMoney(market.countryCode)) {
        setPaying(true);
        setLoadingPaymentMethods(true);
        setPaymentPickerVisible(true);
        const methods = await loadLocalPaymentMethods(accessToken, {
          entityType: "delivery_request",
          entityId: lastCreatedId,
          countryCode: market.countryCode,
        });
        setPaymentMethods(methods);
        setLoadingPaymentMethods(false);
        setPaying(false);
        return;
      }

      setPaying(true);

      await startCheckoutForDeliveryRequest(lastCreatedId, accessToken);

      const paid = await waitForDeliveryPayment(lastCreatedId);

      if (!paid) {
        Alert.alert(
          tr("deliveryRequest.payment.pendingTitle", "Paiement en attente"),
          tr("deliveryRequest.payment.pendingBody", "Le paiement a commencé, mais la confirmation est encore en attente. Le chauffeur ne verra pas la commande tant que le paiement n’est pas confirmé.")
        );
        return;
      }

      const orderId = await createOrderFromPaidDeliveryRequest(lastCreatedId, user.id);

      Alert.alert(
        tr("deliveryRequest.payment.successTitle", "Paiement réussi ✅"),
        orderId
          ? tr("deliveryRequest.payment.successOrderVisible", "Ton paiement est confirmé et la commande est maintenant visible pour les chauffeurs.")
          : tr("deliveryRequest.payment.successBody", "Ton paiement est confirmé.")
      );
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : tr("deliveryRequest.payment.unableToStart", "Impossible de démarrer le paiement pour le moment.");
      Alert.alert(tr("deliveryRequest.payment.errorTitle", "Erreur de paiement"), message);
    } finally {
      setPaying(false);
    }
  }, [lastCreatedId, paying, createOrderFromPaidDeliveryRequest, waitForDeliveryPayment, tr, market.countryCode]);

  const handleLocalPaymentSelection = useCallback(
    async (method: PaymentMethodOption) => {
      if (!lastCreatedId || !market.countryCode) return;
      setPaymentPickerVisible(false);

      try {
        setPaying(true);
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        const user = sessionData?.session?.user;
        const accessToken = sessionData?.session?.access_token;
        if (!user || !accessToken) {
          throw new Error(tr("deliveryRequest.errors.loginRequiredPay", "Tu dois être connecté pour payer."));
        }

        const result = await startLocalPaymentForMethod(accessToken, {
          entityType: "delivery_request",
          entityId: lastCreatedId,
          countryCode: market.countryCode,
          methodCode: method.method_code,
        });

        const paid = result.paid || (await waitForDeliveryPayment(lastCreatedId));
        if (!paid) {
          Alert.alert(
            tr("deliveryRequest.payment.pendingTitle", "Paiement en attente"),
            result.error ??
              tr(
                "deliveryRequest.payment.pendingBody",
                "Le paiement a commencé, mais la confirmation est encore en attente. Le chauffeur ne verra pas la commande tant que le paiement n’est pas confirmé."
              )
          );
          return;
        }

        const orderId = await createOrderFromPaidDeliveryRequest(lastCreatedId, user.id);
        Alert.alert(
          tr("deliveryRequest.payment.successTitle", "Paiement réussi ✅"),
          orderId
            ? tr(
                "deliveryRequest.payment.successOrderVisible",
                "Ton paiement est confirmé et la commande est maintenant visible pour les chauffeurs."
              )
            : tr("deliveryRequest.payment.successBody", "Ton paiement est confirmé.")
        );
      } catch (e: unknown) {
        const message =
          e instanceof Error
            ? e.message
            : tr("deliveryRequest.payment.unableToStart", "Impossible de démarrer le paiement pour le moment.");
        Alert.alert(tr("deliveryRequest.payment.errorTitle", "Erreur de paiement"), message);
      } finally {
        setPaying(false);
      }
    },
    [
      lastCreatedId,
      market.countryCode,
      createOrderFromPaidDeliveryRequest,
      waitForDeliveryPayment,
      tr,
    ]
  );

  return (
    <>
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
                {tr("deliveryRequest.header.title", "Demander une livraison")}
              </Text>

            <Text
              style={{
                color: "#CBD5E1",
                fontSize: 16,
                lineHeight: 22,
              }}
            >
              {tr(
                "deliveryRequest.header.subtitle",
                "Crée une livraison de colis ou une course privée sans passer par le restaurant."
              )}
            </Text>
          </View>

          {deliveryBlocked ? (
            <View
              style={{
                marginBottom: 20,
                padding: 16,
                borderRadius: 16,
                backgroundColor: "rgba(239,68,68,0.12)",
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.35)",
              }}
            >
              <Text style={{ color: "#FCA5A5", fontWeight: "700", marginBottom: 6 }}>
                {tr("deliveryRequest.unavailable.title", "Delivery unavailable")}
              </Text>
              <Text style={{ color: "#FECACA", lineHeight: 20 }}>
                {deliveryBlockedMessage}
              </Text>
            </View>
          ) : null}

          <View style={{ marginBottom: 20 }}>
            <Text
              style={{
                color: "white",
                fontSize: 16,
                fontWeight: "800",
                marginBottom: 12,
              }}
            >
                {tr("deliveryRequest.type.title", "Choisis le type de demande")}
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
                {tr("deliveryRequest.type.packageTitle", "Envoyer un colis")}
              </Text>

                <Text style={{ color: "#94A3B8", fontSize: 14 }}>
                {tr("deliveryRequest.type.packageBody", "Livre des documents, colis ou objets personnels.")}
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
                {tr("deliveryRequest.type.rideTitle", "Demander une course")}
              </Text>

                <Text style={{ color: "#94A3B8", fontSize: 14 }}>
                {tr("deliveryRequest.type.rideBody", "Réserve directement un chauffeur privé.")}
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
                {tr("deliveryRequest.details.title", "Détails de la demande")}
              </Text>

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
                {tr("deliveryRequest.fields.title", "Titre")}
              </Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={
                requestType === "ride"
                  ? tr("deliveryRequest.fields.titleRidePlaceholder", "Exemple : course aéroport")
                  : tr("deliveryRequest.fields.titlePackagePlaceholder", "Exemple : documents importants")
              }
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
                {tr("deliveryRequest.fields.pickupAddress", "Adresse pickup")}
              </Text>
            <TextInput
              value={pickupAddress}
              onChangeText={(value) => {
                setPickupAddress(value);
                lastEstimateKeyRef.current = "";
              }}
              placeholder={tr("deliveryRequest.fields.pickupPlaceholder", "Entre l’adresse pickup")}
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
                {tr("deliveryRequest.fields.dropoffAddress", "Adresse dropoff")}
              </Text>
            <TextInput
              value={dropoffAddress}
              onChangeText={(value) => {
                setDropoffAddress(value);
                lastEstimateKeyRef.current = "";
              }}
              placeholder={tr("deliveryRequest.fields.dropoffPlaceholder", "Entre l’adresse dropoff")}
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 10 }]}
            />
            <TouchableOpacity
              onPress={openDropoffLocationPicker}
              style={{
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                marginBottom: 14,
                borderWidth: 1,
                borderColor: dropoffLocationId ? "#22C55E" : "#334155",
                backgroundColor: dropoffLocationId
                  ? "rgba(34,197,94,0.12)"
                  : "rgba(15,23,42,0.8)",
              }}
            >
              <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
                {dropoffLocationId
                  ? tr("deliveryRequest.fields.dropoffPinned", "Dropoff pinned on map")
                  : tr("deliveryRequest.fields.pinDropoff", "Pin exact dropoff on map")}
              </Text>
            </TouchableOpacity>

            {requestType === "package" ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#334155",
                  backgroundColor: "rgba(15,23,42,0.8)",
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  marginBottom: 14,
                }}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: "#F8FAFC", fontSize: 14, fontWeight: "700" }}>
                    {tr("deliveryRequest.leaveAtDoor.title", "Laisser devant la porte")}
                  </Text>
                  <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                    {tr(
                      "deliveryRequest.leaveAtDoor.hint",
                      "Autorise le livreur à déposer le colis devant la porte après l’attente maximale (photo obligatoire)."
                    )}
                  </Text>
                </View>
                <Switch
                  value={leaveAtDoor}
                  onValueChange={setLeaveAtDoor}
                  trackColor={{ false: "#475569", true: "#166534" }}
                  thumbColor={leaveAtDoor ? "#22C55E" : "#CBD5E1"}
                />
              </View>
            ) : null}

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              </Text>
            <TextInput
              value={pickupContactName}
              onChangeText={setPickupContactName}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
                {tr("deliveryRequest.fields.pickupPhone", "Téléphone pickup")}
              </Text>
            <TextInput
              value={pickupPhone}
              onChangeText={setPickupPhone}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor="#64748B"
              keyboardType="phone-pad"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
                {tr("deliveryRequest.fields.dropoffContactName", "Nom du contact dropoff")}
              </Text>
            <TextInput
              value={dropoffContactName}
              onChangeText={setDropoffContactName}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor="#64748B"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
                {tr("deliveryRequest.fields.dropoffPhone", "Téléphone dropoff")}
              </Text>
            <TextInput
              value={dropoffPhone}
              onChangeText={setDropoffPhone}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor="#64748B"
              keyboardType="phone-pad"
              style={[inputStyle, { marginBottom: 14 }]}
            />

            <Text style={{ color: "#CBD5E1", fontSize: 13, marginBottom: 8 }}>
              {requestType === "ride"
                ? tr("deliveryRequest.fields.rideNotes", "Notes pour la course")
                : tr("deliveryRequest.fields.packageDescription", "Description du colis")}
            </Text>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder={
                requestType === "ride"
                  ? tr("deliveryRequest.fields.rideNotesPlaceholder", "Notes optionnelles pour la course")
                  : tr("deliveryRequest.fields.packageDescriptionPlaceholder", "Décris le colis")
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
                {tr("deliveryRequest.pricing.title", "Résumé du prix")}
              </Text>

            {pricingLoading ? (
              <Text style={{ color: "#93C5FD", fontSize: 14 }}>
                {tr("deliveryRequest.pricing.loading", "Chargement des prix admin...")}
              </Text>
            ) : estimating ? (
              <Text style={{ color: "#93C5FD", fontSize: 14 }}>
                {tr("deliveryRequest.pricing.calculating", "Calcul de l’estimation...")}
              </Text>
            ) : estimateError ? (
              <Text style={{ color: "#FCA5A5", fontSize: 14, lineHeight: 21 }}>
                {estimateError}
              </Text>
            ) : estimateReady ? (
              <>
                <Text style={{ color: "#86EFAC", fontSize: 14, fontWeight: "800" }}>
                {tr("deliveryRequest.pricing.ready", "Estimation prête.")}
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
                  Service fee:{" "}
                  <Text style={{ color: "white", fontWeight: "800" }}>
                    {money(serviceFee, currency)}
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
                {tr(
                  "deliveryRequest.pricing.emptyHint",
                  "Entre des adresses pickup et dropoff complètes. L’estimation sera calculée automatiquement avec les prix admin de pricing_config."
                )}
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
                {tr("deliveryRequest.created.cardTitle", "Demande de livraison créée")}
              </Text>
              <Text style={{ color: "#D1FAE5", fontSize: 13, marginTop: 6 }}>
                ID: {lastCreatedId.slice(0, 8)}
              </Text>
              <Text style={{ color: "#D1FAE5", fontSize: 13, marginTop: 6 }}>
                {tr("deliveryRequest.created.payHint", "Tu peux maintenant continuer vers le paiement sécurisé.")}
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
                {tr("deliveryRequest.actions.calculate", "Calculer le prix de livraison")}
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
                {tr("deliveryRequest.actions.create", "Créer la demande de livraison")}
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
                {tr("deliveryRequest.actions.payNow", "Payer maintenant")}
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
                {tr("common.back", "Retour")}
              </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    <PaymentMethodPicker
      visible={paymentPickerVisible}
      title={tr("deliveryRequest.payment.title", "Paiement")}
      methods={paymentMethods}
      loading={loadingPaymentMethods}
      onClose={() => setPaymentPickerVisible(false)}
      onSelect={handleLocalPaymentSelection}
    />
  </>
  );
}

export default DeliveryRequestScreen;