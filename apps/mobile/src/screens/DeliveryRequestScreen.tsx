import { toUserFacingError } from "../lib/userFacingError";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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
  Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { API_BASE_URL } from "../lib/apiBase";
import { fetchMapboxComputeDistance } from "../lib/mapboxComputeDistance";
import * as WebBrowser from "expo-web-browser";
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
  confirmDeliveryQuoteCheckoutPaid,
  createDeliveryRequest,
  quoteDeliveryRequest,
  startDeliveryCheckoutFromQuote,
  syncPaidDeliveryRequestOrder,
  type DeliveryRequestPricingPayload,
} from "../lib/deliveryRequestApi";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { ClientServiceBottomNav } from "../components/navigation/ClientServiceBottomNav";
import { useSafeBackNavigation } from "../navigation/navigationBack";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";
import { formatDistance, formatTripDurationFromSeconds, resolveRouteDurationSeconds } from "../i18n/formatters";

const MMD_GREEN = MMD_TAXI_GREEN;
const MMD_GLASS_BORDER = MMD_GOLD_CLASSIC_BORDER;
const MMD_FIELD_BG = "rgba(255,255,255,0.06)";
const MMD_MUTED_70 = "rgba(255,255,255,0.7)";
const PIN_BUTTON_ICON = require("../../assets/brand/icons/taxi-quote/pin-button.png");

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
  const insets = useSafeAreaInsets();
  const safeBack = useSafeBackNavigation("ClientHome");
  const { t, i18n } = useTranslation();

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
  const [pickupLocationId, setPickupLocationId] = useState<string | null>(null);
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
  const [requestPaid, setRequestPaid] = useState(false);
  const [serverPricing, setServerPricing] = useState<DeliveryRequestPricingPayload | null>(null);

  const autoEstimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEstimateRequestIdRef = useRef<number>(0);
  const lastEstimateKeyRef = useRef<string>("");

  const subtotal = serverPricing?.subtotal ?? 0;
  const tax = serverPricing?.tax ?? 0;
  const serviceFee = serverPricing?.service_fee ?? 0;
  const displayDeliveryFee = serverPricing?.delivery_fee ?? null;
  const displayGrandTotal = serverPricing?.total ?? null;
  const currency =
    pricingConfig?.currency ||
    (market.scopeResolved ? market.currencyCode : "USD");

  const deliveryBlocked = market.scopeResolved && !market.deliveryAvailable;
  const deliveryBlockedMessage =
    platformFeatures.service_messages?.delivery ??
    platformFeatures.message ??
    tr(
      "deliveryRequest.errors.unavailableInArea",
      "Delivery service is not available in this county yet."
    );

  const total = useMemo(() => displayGrandTotal, [displayGrandTotal]);

  const estimateReady = useMemo(() => {
    return (
      serverPricing != null &&
      Number.isFinite(Number(serverPricing.total_cents)) &&
      Number(serverPricing.total_cents) > 0 &&
      pickupCoords != null &&
      dropoffCoords != null
    );
  }, [serverPricing, pickupCoords, dropoffCoords]);

  const canPay = useMemo(() => {
    return (
      Boolean(lastCreatedId) &&
      !requestPaid &&
      !submitting &&
      !estimating &&
      !pricingLoading &&
      !paying
    );
  }, [lastCreatedId, requestPaid, submitting, estimating, pricingLoading, paying]);

  const inputStyle = {
    backgroundColor: MMD_FIELD_BG,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: MMD_GLASS_BORDER,
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    minHeight: 42,
  };

  const resetEstimateState = useCallback(() => {
    setDistanceMiles(null);
    setEtaMinutes(null);
    setDeliveryFee(null);
    setPickupCoords(null);
    setDropoffCoords(null);
    setEstimateError(null);
    setServerPricing(null);
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

  const handlePickupLocation = useCallback(
    (location: Parameters<typeof applyMmdLocationSelection>[0]) => {
      applyMmdLocationSelection(location, {
        setLocationId: (id) => setPickupLocationId(id),
        setAddress: (value) => {
          setPickupAddress(value);
          lastEstimateKeyRef.current = "";
        },
        setCoords: setPickupCoords,
      });
    },
    []
  );

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
    delivery_pickup: handlePickupLocation,
    delivery_dropoff: handleDropoffLocation,
  });

  function openPickupLocationPicker() {
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
      title: tr("deliveryRequest.fields.pickupExactLocation", "Pickup exact location"),
      submitLabel: tr("deliveryRequest.fields.usePickupLocation", "Use pickup location"),
      returnTo: "DeliveryRequest",
      pickerContext: "delivery_pickup",
    });
  }

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
            tr("deliveryRequest.alerts.missingConfigBody", "API_BASE_URL n’est pas configurée. Configure EXPO_PUBLIC_API_URL_PROD (via getApiBaseUrl).")
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

        if (
          typeof pLat !== "number" ||
          typeof pLng !== "number" ||
          typeof dLat !== "number" ||
          typeof dLng !== "number" ||
          Number.isNaN(pLat) ||
          Number.isNaN(pLng) ||
          Number.isNaN(dLat) ||
          Number.isNaN(dLng)
        ) {
          const friendly = tr(
            "deliveryRequest.errors.missingCoords",
            "Impossible de confirmer les coordonnées GPS. Vérifie les adresses."
          );
          resetEstimateState();
          setEstimateError(friendly);
          if (!silent) {
            Alert.alert(tr("deliveryRequest.alerts.estimateFailedTitle", "Estimation échouée"), friendly);
          }
          return false;
        }

        const nextPickup = { lat: pLat, lng: pLng };
        const nextDropoff = { lat: dLat, lng: dLng };
        setDistanceMiles(dMiles);
        setEtaMinutes(tMinutes);
        setPickupCoords(nextPickup);
        setDropoffCoords(nextDropoff);

        const quote = await quoteDeliveryRequest(
          {
            request_type: requestType,
            title: cleanText(title) || (requestType === "package" ? "Package delivery" : "Delivery"),
            description: cleanText(description) || null,
            pickup_address: pickupValue,
            dropoff_address: dropoffValue,
            pickup_contact_name: cleanText(pickupContactName) || null,
            pickup_phone: cleanText(pickupPhone) || null,
            dropoff_contact_name: cleanText(dropoffContactName) || null,
            dropoff_phone: cleanText(dropoffPhone) || null,
            pickup_lat: pLat,
            pickup_lng: pLng,
            dropoff_lat: dLat,
            dropoff_lng: dLng,
            dropoff_location_id: dropoffLocationId,
            leave_at_door: requestType === "package" ? leaveAtDoor : false,
          },
          {
            countryCode: market.countryCode,
            lat: dLat,
            lng: dLng,
          }
        );

        if (activeEstimateRequestIdRef.current !== requestId) {
          return false;
        }

        setServerPricing(quote);
        setDeliveryFee(roundMoney(quote.delivery_fee));
        if (Number.isFinite(Number(quote.distance_miles))) {
          setDistanceMiles(Number(quote.distance_miles));
        }
        if (Number.isFinite(Number(quote.eta_minutes))) {
          setEtaMinutes(Number(quote.eta_minutes));
        }

        setEstimateError(null);
        return true;
      } catch (e: unknown) {
        if (activeEstimateRequestIdRef.current !== requestId) {
          return false;
        }

        const friendly = getFriendlyEstimateError(
          toUserFacingError(e, tr("deliveryRequest.errors.estimateGeneric", "Impossible de calculer l'estimation.")),
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
    [
      pickupAddress,
      dropoffAddress,
      resetEstimateState,
      requestType,
      title,
      description,
      pickupContactName,
      pickupPhone,
      dropoffContactName,
      dropoffPhone,
      dropoffLocationId,
      leaveAtDoor,
      market.countryCode,
      tr,
    ]
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

      const scope = {
        countryCode: market.countryCode,
        lat: dropoffCoords.lat,
        lng: dropoffCoords.lng,
      };

      const requestPayload = {
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
      } as const;

      // Local mobile money still needs an entity id today.
      if (market.countryCode && shouldOfferLocalMobileMoney(market.countryCode)) {
        const { deliveryRequestId, pricing } = await createDeliveryRequest(
          requestPayload,
          scope
        );

        setServerPricing(pricing);
        setDeliveryFee(roundMoney(pricing.delivery_fee));
        setLastCreatedId(deliveryRequestId);
        setRequestPaid(false);

        Alert.alert(
          tr("deliveryRequest.alerts.createdTitle", "Demande créée ✅"),
          tr("deliveryRequest.alerts.createdBody", "Demande de livraison créée. Appuie sur Payer maintenant pour finaliser le paiement.")
        );

        console.log("delivery_requests created:", deliveryRequestId);
        return;
      }

      const expectedQuoteTotalCents = Number.isFinite(Number(serverPricing?.total_cents))
        ? Math.round(Number(serverPricing?.total_cents))
        : 0;
      if (!(expectedQuoteTotalCents > 0)) {
        throw new Error(
          tr(
            "deliveryRequest.errors.quoteRequired",
            "Le devis serveur est requis avant le paiement. Recalcule l’estimation."
          )
        );
      }

      // Stripe pay-then-create: no delivery_requests row until payment is confirmed.
      const checkout = await startDeliveryCheckoutFromQuote(
        {
          ...requestPayload,
          expectedQuoteTotalCents,
        },
        scope
      );

      if (!checkout?.ok || !checkout?.url || !checkout?.delivery_checkout_id) {
        throw new Error(
          String(checkout?.error ?? checkout?.message ?? "").trim() ||
            tr("deliveryRequest.errors.createFailed", "Impossible de créer la demande.")
        );
      }

      const deliveryCheckoutId = String(checkout.delivery_checkout_id);
      const sessionId = checkout.session_id ? String(checkout.session_id) : null;

      await WebBrowser.openBrowserAsync(String(checkout.url));

      let confirmResult: {
        ok?: boolean;
        already?: boolean;
        already_paid?: boolean;
        stripe_paid?: boolean;
        delivery_request_id?: string;
        payment_status?: string;
      } | null = null;
      let confirmThrew = false;
      try {
        confirmResult = await confirmDeliveryQuoteCheckoutPaid(
          deliveryCheckoutId,
          sessionId
        );
      } catch {
        confirmThrew = true;
      }

      const deliveryRequestId = String(
        confirmResult?.delivery_request_id ?? ""
      ).trim();
      const paidOk =
        !confirmThrew &&
        Boolean(deliveryRequestId) &&
        (confirmResult?.ok === true ||
          confirmResult?.already === true ||
          confirmResult?.already_paid === true ||
          confirmResult?.stripe_paid === true ||
          String(confirmResult?.payment_status ?? "").toLowerCase() === "paid");

      if (!paidOk) {
        Alert.alert(
          tr("deliveryRequest.payment.title", "Paiement"),
          tr(
            "deliveryRequest.payment.notCompletedNoRequest",
            "Le paiement n’a pas été terminé. Aucune demande de livraison n’a été créée."
          )
        );
        return;
      }

      setLastCreatedId(deliveryRequestId);
      setRequestPaid(true);

      let orderId: string | null = null;
      try {
        orderId = await createOrderFromPaidDeliveryRequest(deliveryRequestId, user.id);
      } catch (syncErr) {
        console.warn("delivery sync-order after quote checkout:", syncErr);
      }

      Alert.alert(
        tr("deliveryRequest.payment.successTitle", "Paiement réussi ✅"),
        orderId
          ? tr("deliveryRequest.payment.successOrderVisible", "Ton paiement est confirmé et la commande est maintenant visible pour les chauffeurs.")
          : tr("deliveryRequest.payment.successBody", "Ton paiement est confirmé.")
      );
    } catch (e: unknown) {
      console.error("❌ create request error:", e);
      Alert.alert(tr("common.error", "Erreur"), toUserFacingError(e, tr("deliveryRequest.errors.createFailed", "Impossible de créer la demande.")));
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
    leaveAtDoor,
    dropoffLocationId,
    pickupCoords,
    dropoffCoords,
    market.countryCode,
    serverPricing,
    createOrderFromPaidDeliveryRequest,
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

      setRequestPaid(true);

      Alert.alert(
        tr("deliveryRequest.payment.successTitle", "Paiement réussi ✅"),
        orderId
          ? tr("deliveryRequest.payment.successOrderVisible", "Ton paiement est confirmé et la commande est maintenant visible pour les chauffeurs.")
          : tr("deliveryRequest.payment.successBody", "Ton paiement est confirmé.")
      );
    } catch (e: unknown) {
      const message =
        toUserFacingError(e, tr("deliveryRequest.payment.unableToStart", "Impossible de démarrer le paiement pour le moment."));
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
        setRequestPaid(true);
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

  const fieldLabelStyle = {
    color: MMD_WHITE,
    fontSize: 16,
    fontWeight: "600" as const,
    fontFamily: MMD_FONT.semibold,
    marginBottom: 8,
  };

  const sectionTitleStyle = {
    color: MMD_WHITE,
    fontSize: 22,
    fontWeight: "600" as const,
    fontFamily: MMD_FONT.semibold,
    marginBottom: 12,
  };

  return (
    <>
    <SafeAreaView style={{ flex: 1, backgroundColor: MMD_BLUE }} edges={["top", "left", "right"]}>
      <StatusBar barStyle="light-content" />

      <ScreenHeader
        title={tr("deliveryRequest.header.title", "Demander une livraison")}
        subtitle={tr(
          "deliveryRequest.header.subtitle",
          "Crée une livraison de colis ou une course privée sans passer par le restaurant."
        )}
        fallbackRoute="ClientHome"
        variant="brand"
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 24,
            paddingBottom: Math.max(insets.bottom + 88, 112),
            gap: 24,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {deliveryBlocked ? (
            <View
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: "rgba(239,68,68,0.12)",
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.35)",
              }}
            >
              <Text style={{ color: "#FCA5A5", fontWeight: "700", fontFamily: MMD_FONT.bold, marginBottom: 6 }}>
                {tr("deliveryRequest.unavailable.title", "Delivery unavailable")}
              </Text>
              <Text style={{ color: "#FECACA", lineHeight: 20, fontFamily: MMD_FONT.regular }}>
                {deliveryBlockedMessage}
              </Text>
            </View>
          ) : null}

          <View>
            <Text style={sectionTitleStyle}>
              {tr("deliveryRequest.type.title", "Request type")}
            </Text>

            <View
              style={{
                flexDirection: "row",
                gap: 4,
                height: 52,
                padding: 4,
                borderRadius: 24,
                backgroundColor: "rgba(255,255,255,0.1)",
                borderWidth: 1,
                borderColor: MMD_GLASS_BORDER,
              }}
            >
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setRequestType("package")}
                style={{
                  flex: 1,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: requestType === "package" ? MMD_GREEN : "transparent",
                }}
              >
                <Text
                  style={{
                    color: MMD_WHITE,
                    fontSize: 16,
                    fontWeight: requestType === "package" ? "700" : "600",
                    fontFamily: requestType === "package" ? MMD_FONT.bold : MMD_FONT.semibold,
                  }}
                >
                  {tr("deliveryRequest.type.packageShort", "Package")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setRequestType("ride")}
                style={{
                  flex: 1,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: requestType === "ride" ? MMD_GREEN : "transparent",
                }}
              >
                <Text
                  style={{
                    color: MMD_WHITE,
                    fontSize: 16,
                    fontWeight: requestType === "ride" ? "700" : "600",
                    fontFamily: requestType === "ride" ? MMD_FONT.bold : MMD_FONT.semibold,
                  }}
                >
                  {tr("deliveryRequest.type.rideShort", "Ride")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View>
            <Text style={sectionTitleStyle}>
              {tr("deliveryRequest.details.title", "Delivery Details")}
            </Text>

            <View
              style={{
                borderRadius: 24,
                backgroundColor: MMD_GLASS,
                borderWidth: 1,
                borderColor: MMD_GLASS_BORDER,
                padding: 20,
                gap: 16,
              }}
            >
            <View>
            <Text style={fieldLabelStyle}>
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
              placeholderTextColor={MMD_MUTED_70}
              style={inputStyle}
            />
            </View>

            <View>
            <Text style={fieldLabelStyle}>
                {tr("deliveryRequest.fields.pickupAddress", "Adresse pickup")}
              </Text>
            <TextInput
              value={pickupAddress}
              onChangeText={(value) => {
                setPickupAddress(value);
                lastEstimateKeyRef.current = "";
              }}
              placeholder={tr("deliveryRequest.fields.pickupPlaceholder", "Entre l’adresse pickup")}
              placeholderTextColor={MMD_MUTED_70}
              style={inputStyle}
            />
            </View>

            <View>
            <Text style={fieldLabelStyle}>
                {tr("deliveryRequest.fields.dropoffAddress", "Adresse dropoff")}
              </Text>
            <TextInput
              value={dropoffAddress}
              onChangeText={(value) => {
                setDropoffAddress(value);
                lastEstimateKeyRef.current = "";
              }}
              placeholder={tr("deliveryRequest.fields.dropoffPlaceholder", "Entre l’adresse dropoff")}
              placeholderTextColor={MMD_MUTED_70}
              style={inputStyle}
            />
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity
              onPress={openPickupLocationPicker}
              style={{
                flex: 1,
                borderRadius: 14,
                height: 52,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 8,
                borderWidth: pickupLocationId ? 1 : 0,
                borderColor: MMD_GREEN,
                backgroundColor: pickupLocationId
                  ? "rgba(34,197,94,0.12)"
                  : MMD_GREEN,
              }}
            >
              <Image source={PIN_BUTTON_ICON} style={{ width: 18, height: 18 }} resizeMode="contain" />
              <Text style={{ color: MMD_WHITE, fontWeight: "800", fontFamily: MMD_FONT.extrabold, fontSize: 14, textAlign: "center" }}>
                {pickupLocationId
                  ? tr("deliveryRequest.fields.pickupPinned", "Pickup pinned")
                  : tr("deliveryRequest.fields.pinPickup", "Pin pickup")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={openDropoffLocationPicker}
              style={{
                flex: 1,
                borderRadius: 14,
                height: 52,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: 8,
                borderWidth: dropoffLocationId ? 1 : 0,
                borderColor: MMD_GREEN,
                backgroundColor: dropoffLocationId
                  ? "rgba(34,197,94,0.12)"
                  : MMD_GREEN,
              }}
            >
              <Image source={PIN_BUTTON_ICON} style={{ width: 18, height: 18 }} resizeMode="contain" />
              <Text style={{ color: MMD_WHITE, fontWeight: "800", fontFamily: MMD_FONT.extrabold, fontSize: 14, textAlign: "center" }}>
                {dropoffLocationId
                  ? tr("deliveryRequest.fields.dropoffPinned", "Dropoff pinned on map")
                  : tr("deliveryRequest.fields.pinDropoff", "Pin exact dropoff on map")}
              </Text>
            </TouchableOpacity>
            </View>

            {requestType === "package" ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: MMD_GLASS_BORDER,
                  backgroundColor: MMD_FIELD_BG,
                  padding: 16,
                }}
              >
                <View style={{ flex: 1, paddingRight: 12 }}>
                  <Text style={{ color: MMD_WHITE, fontSize: 16, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {tr("deliveryRequest.leaveAtDoor.title", "Laisser devant la porte")}
                  </Text>
                  <Text style={{ color: MMD_MUTED_70, fontSize: 13, marginTop: 4, lineHeight: 18, fontFamily: MMD_FONT.regular }}>
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
                  thumbColor={leaveAtDoor ? MMD_GREEN : "#CBD5E1"}
                />
              </View>
            ) : null}

            <View>
            <Text style={fieldLabelStyle}>
                {tr("deliveryRequest.fields.pickupContactName", "Pickup Contact Name")}
              </Text>
            <TextInput
              value={pickupContactName}
              onChangeText={setPickupContactName}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor={MMD_MUTED_70}
              style={inputStyle}
            />
            </View>

            <View>
            <Text style={fieldLabelStyle}>
                {tr("deliveryRequest.fields.pickupPhone", "Téléphone pickup")}
              </Text>
            <TextInput
              value={pickupPhone}
              onChangeText={setPickupPhone}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor={MMD_MUTED_70}
              keyboardType="phone-pad"
              style={inputStyle}
            />
            </View>

            <View>
            <Text style={fieldLabelStyle}>
                {tr("deliveryRequest.fields.dropoffContactName", "Nom du contact dropoff")}
              </Text>
            <TextInput
              value={dropoffContactName}
              onChangeText={setDropoffContactName}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor={MMD_MUTED_70}
              style={inputStyle}
            />
            </View>

            <View>
            <Text style={fieldLabelStyle}>
                {tr("deliveryRequest.fields.dropoffPhone", "Téléphone dropoff")}
              </Text>
            <TextInput
              value={dropoffPhone}
              onChangeText={setDropoffPhone}
              placeholder={tr("common.optional", "Optionnel")}
              placeholderTextColor={MMD_MUTED_70}
              keyboardType="phone-pad"
              style={inputStyle}
            />
            </View>

            <View>
            <Text style={fieldLabelStyle}>
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
              placeholderTextColor={MMD_MUTED_70}
              multiline
              textAlignVertical="top"
              style={[
                inputStyle,
                {
                  minHeight: 110,
                },
              ]}
            />
            </View>
            </View>
          </View>

          <View>
            <Text style={sectionTitleStyle}>
              {tr("deliveryRequest.pricing.title", "Price Summary")}
            </Text>

          <View
            style={{
              borderRadius: 24,
              backgroundColor: MMD_GLASS,
              borderWidth: 1,
              borderColor: MMD_GLASS_BORDER,
              padding: 20,
            }}
          >
            {pricingLoading ? (
              <Text style={{ color: MMD_GOLD_BRIGHT, fontSize: 14, fontFamily: MMD_FONT.regular }}>
                {tr("deliveryRequest.pricing.loading", "Chargement des prix admin...")}
              </Text>
            ) : estimating ? (
              <Text style={{ color: MMD_GOLD_BRIGHT, fontSize: 14, fontFamily: MMD_FONT.regular }}>
                {tr("deliveryRequest.pricing.calculating", "Calcul de l’estimation...")}
              </Text>
            ) : estimateError ? (
              <Text style={{ color: "#FCA5A5", fontSize: 14, lineHeight: 21, fontFamily: MMD_FONT.regular }}>
                {estimateError}
              </Text>
            ) : estimateReady ? (
              <>
                <View
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: MMD_BLUE,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    marginBottom: 12,
                  }}
                >
                  <Text style={{ color: MMD_WHITE, fontSize: 14, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {tr("deliveryRequest.pricing.ready", "Estimation ready")}
                  </Text>
                </View>

                <Text style={{ color: MMD_MUTED_70, fontSize: 14, fontFamily: MMD_FONT.regular }}>
                  {tr("deliveryRequest.pricing.distance", "Distance")}
                  {": "}
                  <Text style={{ color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {distanceMiles != null ? formatDistance(distanceMiles, i18n.language) : "—"}
                  </Text>
                </Text>

                <Text style={{ color: MMD_MUTED_70, fontSize: 14, marginTop: 12, fontFamily: MMD_FONT.regular }}>
                  {tr("deliveryRequest.pricing.eta", "ETA")}
                  {": "}
                  <Text style={{ color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {etaMinutes != null
                      ? formatTripDurationFromSeconds(
                          resolveRouteDurationSeconds({ durationMinutes: etaMinutes }) ?? 0
                        )
                      : "—"}
                  </Text>
                </Text>

                <Text style={{ color: MMD_MUTED_70, fontSize: 14, marginTop: 12, fontFamily: MMD_FONT.regular }}>
                  {tr("deliveryRequest.pricing.deliveryFee", "Delivery fee")}
                  {": "}
                  <Text style={{ color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {money(displayDeliveryFee, currency)}
                  </Text>
                </Text>

                <Text style={{ color: MMD_MUTED_70, fontSize: 14, marginTop: 12, fontFamily: MMD_FONT.regular }}>
                  {tr("deliveryRequest.pricing.tax", "Tax")}
                  {": "}
                  <Text style={{ color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {money(tax, currency)}
                  </Text>
                </Text>

                <Text style={{ color: MMD_MUTED_70, fontSize: 14, marginTop: 12, fontFamily: MMD_FONT.regular }}>
                  {tr("deliveryRequest.pricing.serviceFee", "Service fee")}
                  {": "}
                  <Text style={{ color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {money(serviceFee, currency)}
                  </Text>
                </Text>

                <Text style={{ color: MMD_MUTED_70, fontSize: 14, marginTop: 12, fontFamily: MMD_FONT.regular }}>
                  {tr("deliveryRequest.pricing.total", "Total")}
                  {": "}
                  <Text style={{ color: MMD_WHITE, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                    {money(total, currency)}
                  </Text>
                </Text>

                <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.1)", marginVertical: 12 }} />

                <Text style={{ color: MMD_MUTED_70, fontSize: 13, fontFamily: MMD_FONT.regular }}>
                  Pickup GPS:{" "}
                  {pickupCoords
                    ? `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}`
                    : "—"}
                </Text>

                <Text style={{ color: MMD_MUTED_70, fontSize: 13, marginTop: 8, fontFamily: MMD_FONT.regular }}>
                  Dropoff GPS:{" "}
                  {dropoffCoords
                    ? `${dropoffCoords.lat.toFixed(5)}, ${dropoffCoords.lng.toFixed(5)}`
                    : "—"}
                </Text>
              </>
            ) : (
              <Text style={{ color: MMD_WHITE, fontSize: 14, lineHeight: 22, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                {tr(
                  "deliveryRequest.pricing.emptyHint",
                  "Enter pickup and dropoff addresses to calculate the estimate automatically."
                )}
              </Text>
            )}
          </View>
          </View>

          {lastCreatedId ? (
            <View
              style={{
                borderRadius: 16,
                backgroundColor: "rgba(34,197,94,0.12)",
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.28)",
                padding: 14,
              }}
            >
              <Text style={{ color: "#86EFAC", fontSize: 14, fontWeight: "700", fontFamily: MMD_FONT.bold }}>
                {requestPaid
                  ? tr("deliveryRequest.created.paidCardTitle", "Demande de livraison payée")
                  : tr("deliveryRequest.created.cardTitle", "Demande de livraison créée")}
              </Text>
              <Text style={{ color: "#D1FAE5", fontSize: 13, marginTop: 6, fontFamily: MMD_FONT.regular }}>
                ID: {lastCreatedId.slice(0, 8)}
              </Text>
              <Text style={{ color: "#D1FAE5", fontSize: 13, marginTop: 6, fontFamily: MMD_FONT.regular }}>
                {requestPaid
                  ? tr(
                      "deliveryRequest.created.paidHint",
                      "Paiement confirmé. Les chauffeurs peuvent maintenant voir ta demande."
                    )
                  : tr("deliveryRequest.created.payHint", "Tu peux maintenant continuer vers le paiement sécurisé.")}
              </Text>
            </View>
          ) : null}

          <View style={{ gap: 12 }}>
          <TouchableOpacity
            onPress={() => void handleEstimate({ silent: false })}
            activeOpacity={0.9}
            disabled={estimating || submitting || pricingLoading || paying}
            style={{
              backgroundColor:
                estimating || submitting || pricingLoading || paying
                  ? "#475569"
                  : MMD_GREEN,
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              minHeight: 56,
            }}
          >
            {estimating ? (
              <ActivityIndicator color={MMD_WHITE} />
            ) : (
              <Text
                style={{
                  color: MMD_WHITE,
                  fontSize: 18,
                  fontWeight: "700",
                  fontFamily: MMD_FONT.bold,
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
              backgroundColor: "transparent",
              borderWidth: 1,
              borderColor:
                submitting || estimating || pricingLoading || paying
                  ? "#64748B"
                  : MMD_GREEN,
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              minHeight: 56,
            }}
          >
            {submitting ? (
              <ActivityIndicator color={MMD_GREEN} />
            ) : (
              <Text
                style={{
                  color:
                    submitting || estimating || pricingLoading || paying
                      ? "#64748B"
                      : MMD_GREEN,
                  fontSize: 18,
                  fontWeight: "700",
                  fontFamily: MMD_FONT.bold,
                }}
              >
                {market.countryCode && shouldOfferLocalMobileMoney(market.countryCode)
                  ? tr("deliveryRequest.actions.create", "Créer la demande de livraison")
                  : tr(
                      "deliveryRequest.actions.payAndConfirm",
                      "Payer et confirmer la livraison"
                    )}
              </Text>
            )}
          </TouchableOpacity>

          {market.countryCode && shouldOfferLocalMobileMoney(market.countryCode) ? (
          <TouchableOpacity
            onPress={handlePay}
            activeOpacity={0.9}
            disabled={!canPay}
            style={{
              backgroundColor: !canPay ? "#64748B" : MMD_GREEN,
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
              minHeight: 56,
            }}
          >
            {paying ? (
              <ActivityIndicator color={MMD_WHITE} />
            ) : (
              <Text
                style={{
                  color: MMD_WHITE,
                  fontSize: 18,
                  fontWeight: "700",
                  fontFamily: MMD_FONT.bold,
                }}
              >
                {tr("deliveryRequest.actions.payNow", "Payer maintenant")}
              </Text>
            )}
          </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            onPress={safeBack}
            activeOpacity={0.85}
            disabled={submitting || estimating || paying}
            style={{
              backgroundColor: MMD_FIELD_BG,
              borderWidth: 1,
              borderColor: MMD_GLASS_BORDER,
              paddingVertical: 16,
              borderRadius: 16,
              alignItems: "center",
              minHeight: 56,
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: MMD_WHITE,
                fontSize: 18,
                fontWeight: "700",
                fontFamily: MMD_FONT.bold,
              }}
            >
                {tr("common.back", "Retour")}
              </Text>
          </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <ClientServiceBottomNav active="orders" appearance="glass" accent="gold" layout="floating" />
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