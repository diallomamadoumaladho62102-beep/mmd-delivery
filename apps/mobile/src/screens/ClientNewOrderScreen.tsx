import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StatusBar,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { API_BASE_URL } from "../lib/apiBase";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { confirmOrderPaid } from "../../lib/payments";
import { fetchMapboxComputeDistance } from "../lib/mapboxComputeDistance";
import { payOrderWithPaymentSheet } from "../utils/stripe";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { useSafeBackNavigation } from "../navigation/navigationBack";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientNewOrder">;

type ApiDeliveryPrice = {
  deliveryFee: number;
  platformFee: number;
  driverPayout: number;
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

type PricingParams = {
  distanceMiles: number;
  durationMinutes: number;
};

function computeDeliveryPricing({
  distanceMiles,
  durationMinutes,
}: PricingParams): number {
  const BASE_FARE = 2.5;
  const PER_MILE = 0.9;
  const PER_MINUTE = 0.15;
  const MIN_FARE = 3.49;

  const raw =
    BASE_FARE + distanceMiles * PER_MILE + durationMinutes * PER_MINUTE;

  const rounded = Math.round(raw * 100) / 100;
  return Math.max(MIN_FARE, rounded);
}

function normalizeAddress(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function money(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)} USD`;
}

function statValue(value: number | null, suffix = "") {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value}${suffix}`;
}

function looksLikeCompleteAddress(value: string) {
  const v = normalizeAddress(value);
  if (v.length < 10) return false;

  const hasNumber = /\d/.test(v);
  const wordCount = v.split(" ").filter(Boolean).length >= 3;

  return hasNumber && wordCount;
}

function getFriendlyEstimateError(
  rawMessage: string | undefined,
  fallback: string,
  t: (key: string, fallback: string) => string
) {
  const text = String(rawMessage || "").trim();
  const lower = text.toLowerCase();

  if (!text) return fallback;

  if (lower.includes("route exceeds maximum distance limitation")) {
    return t(
      "client.newOrder.errors.tooFarOrImprecise",
      "Distance trop grande ou adresse trop imprécise. Vérifie la rue, le ZIP code, la ville et l’État."
    );
  }

  if (lower.includes("aucune route trouvée") || lower.includes("no route")) {
    return t(
      "client.newOrder.errors.noRouteFound",
      "Aucune route trouvée entre ces adresses. Vérifie l’adresse de destination."
    );
  }

  if (lower.includes("network request failed")) {
    return t(
      "client.newOrder.errors.networkFailed",
      "Impossible de joindre le serveur pour le moment. Vérifie le réseau local puis réessaie."
    );
  }

  if (lower.includes("timed out") || lower.includes("abort")) {
    return t(
      "client.newOrder.errors.timeout",
      "La requête d’estimation a pris trop de temps. Réessaie dans un instant."
    );
  }

  return text;
}

function toSafeMoney(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasValidCoordinate(latValue: unknown, lngValue: unknown) {
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


function cleanApiBaseUrl() {
  const raw = String(API_BASE_URL || "").trim().replace(/\/+$/, "");

  if (!raw) return "";

  return /^https?:\/\//i.test(raw) ? raw : "";
}

export function ClientNewOrderScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const { t } = useTranslation();
  const safeBack = useSafeBackNavigation("ClientHome");

  const restaurantIdFromParams: string | null =
    route?.params?.restaurantId ?? null;

  const restaurantAddressFromParams: string =
    route?.params?.restaurantAddress ?? route?.params?.pickupAddress ?? "";

  const [pickup, setPickup] = useState(restaurantAddressFromParams || "");
  const [dropoff, setDropoff] = useState("");

  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState(false);

  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);

  const [pickupCoords, setPickupCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [dropoffCoords, setDropoffCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [newOrderId, setNewOrderId] = useState<string | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const pickupLocked = !!restaurantAddressFromParams;

  const lastEstimateKeyRef = useRef<string>("");
  const autoEstimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEstimateRequestIdRef = useRef<number>(0);

  const canCreate =
    !creating &&
    !paying &&
    !loading &&
    distanceMiles != null &&
    etaMinutes != null &&
    deliveryFee != null &&
    !!pickupCoords &&
    !!dropoffCoords;

  const canPay = !paying && !!newOrderId;

  const itemsSubtotalFromParams = useMemo(
    () =>
      toSafeMoney(
        firstFiniteNumber(
          route?.params?.subtotal,
          route?.params?.subTotal,
          route?.params?.itemsSubtotal,
          route?.params?.cartSubtotal,
          route?.params?.foodSubtotal
        ) ?? 0
      ),
    [route?.params]
  );

  const taxAmountFromParams = useMemo(
    () =>
      toSafeMoney(
        firstFiniteNumber(
          route?.params?.tax,
          route?.params?.taxes,
          route?.params?.taxAmount,
          route?.params?.tax_amount
        ) ?? 0
      ),
    [route?.params]
  );

  const baseOrderTotalFromParams = useMemo(() => {
    const explicitBaseTotal = firstFiniteNumber(
      route?.params?.itemsTotal,
      route?.params?.orderSubtotalWithTax,
      route?.params?.totalBeforeDelivery,
      route?.params?.preDeliveryTotal
    );

    if (explicitBaseTotal != null) {
      return toSafeMoney(explicitBaseTotal);
    }

    return roundMoney(itemsSubtotalFromParams + taxAmountFromParams);
  }, [route?.params, itemsSubtotalFromParams, taxAmountFromParams]);

  const orderSummary = useMemo(() => {
    const fee = deliveryFee ?? 0;
    const itemsSubtotal = itemsSubtotalFromParams;
    const taxAmount = taxAmountFromParams;
    const preDeliveryTotal = baseOrderTotalFromParams;
    const finalTotal = roundMoney(preDeliveryTotal + fee);

    return {
      fee,
      itemsSubtotal,
      taxAmount,
      preDeliveryTotal,
      finalTotal,
      eta: etaMinutes != null ? Math.round(etaMinutes) : null,
      distance: distanceMiles != null ? distanceMiles.toFixed(2) : null,
    };
  }, [
    deliveryFee,
    etaMinutes,
    distanceMiles,
    itemsSubtotalFromParams,
    taxAmountFromParams,
    baseOrderTotalFromParams,
  ]);

  async function resolveRestaurant(): Promise<{
    restaurant_id: string;
    restaurant_user_id: string;
    restaurant_address: string;
    restaurant_lat: number;
    restaurant_lng: number;
  }> {
    if (!restaurantIdFromParams) {
      throw new Error(
        t(
          "client.newOrder.errors.noRestaurantSelected",
          "Aucun restaurant sélectionné. Retourne à la liste des restaurants et choisis un restaurant."
        )
      );
    }

    const { data: rp, error } = await supabase
      .from("restaurant_profiles")
      .select(
        "user_id, restaurant_name, address, status, is_accepting_orders, location_lat, location_lng"
      )
      .eq("user_id", restaurantIdFromParams)
      .eq("status", "approved")
      .eq("is_accepting_orders", true)
      .maybeSingle();

    if (error) {
      console.log("resolveRestaurant fetch error:", error);
      throw error;
    }

    if (!rp) {
      throw new Error(
        t(
          "client.newOrder.errors.restaurantUnavailable",
          "Ce restaurant n’est pas disponible pour les commandes actuellement."
        )
      );
    }

    const restaurantAddress = String((rp as any).address || "").trim();
    const restaurantLat = Number((rp as any).location_lat);
    const restaurantLng = Number((rp as any).location_lng);
    const restaurantUserId = String((rp as any).user_id || "").trim();

    if (!restaurantUserId) {
      throw new Error(
        t(
          "client.newOrder.errors.restaurantMissingOwner",
          "Ce restaurant n’a pas encore un propriétaire valide."
        )
      );
    }

    if (!restaurantAddress || !hasValidCoordinate(restaurantLat, restaurantLng)) {
      throw new Error(
        t(
          "client.newOrder.errors.restaurantMissingLocation",
          "Ce restaurant n’a pas encore une adresse GPS valide. Il doit compléter son profil avant de recevoir des commandes."
        )
      );
    }

    return {
      restaurant_id: restaurantIdFromParams,
      restaurant_user_id: restaurantUserId,
      restaurant_address: restaurantAddress,
      restaurant_lat: restaurantLat,
      restaurant_lng: restaurantLng,
    };
  }

  function resetEstimateState() {
    setDistanceMiles(null);
    setEtaMinutes(null);
    setDeliveryFee(null);
    setPickupCoords(null);
    setDropoffCoords(null);
    setNewOrderId(null);
    setEstimateError(null);
  }

  useEffect(() => {
    resetEstimateState();
    lastEstimateKeyRef.current = "";
  }, [pickup, dropoff]);

  function addressesReadyForAutoEstimate() {
    const pickupValue = normalizeAddress(pickup);
    const dropoffValue = normalizeAddress(dropoff);

    return (
      looksLikeCompleteAddress(pickupValue) &&
      looksLikeCompleteAddress(dropoffValue)
    );
  }

  async function handleEstimateDelivery(options?: { silent?: boolean }) {
    const silent = options?.silent === true;

    const pickupValue = normalizeAddress(pickup);
    const dropoffValue = normalizeAddress(dropoff);

    if (loading) return false;

    if (!pickupValue || !dropoffValue) {
      if (!silent) {
        Alert.alert(
          t("client.newOrder.alerts.missingFieldsTitle", "Champs manquants"),
          t(
            "client.newOrder.alerts.missingFieldsBody",
            "Merci de remplir l’adresse pickup et l’adresse de livraison."
          )
        );
      }
      return false;
    }

    if (
      !looksLikeCompleteAddress(pickupValue) ||
      !looksLikeCompleteAddress(dropoffValue)
    ) {
      if (!silent) {
        Alert.alert(
          t("client.newOrder.alerts.missingFieldsTitle", "Adresse incomplète"),
          t(
            "client.newOrder.alerts.incompleteAddressBody",
            "Merci de saisir des adresses plus complètes avant le calcul."
          )
        );
      }
      return false;
    }

    const apiBaseUrl = cleanApiBaseUrl();

    if (!apiBaseUrl) {
      if (!silent) {
        Alert.alert(
          t("client.newOrder.alerts.missingConfigTitle", "Configuration manquante"),
          t(
            "client.newOrder.alerts.missingConfigBody",
            "API_BASE_URL n’est pas configurée. Ajoute EXPO_PUBLIC_WEB_BASE_URL dans app.json."
          )
        );
      }
      return false;
    }

    const requestId = Date.now();
    activeEstimateRequestIdRef.current = requestId;

    try {
      setLoading(true);
      setEstimateError(null);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const res = await fetchMapboxComputeDistance({
        apiBaseUrl,
        body: {
          pickupAddress: pickupValue,
          dropoffAddress: dropoffValue,
        },
        signal: controller.signal,
      });

      const rawText = await res.text();
      clearTimeout(timeout);

      let json: MapboxDistanceResponse | null = null;
      try {
        json = JSON.parse(rawText);
      } catch {
        json = null;
      }

      if (activeEstimateRequestIdRef.current !== requestId) {
        return false;
      }

      if (!res.ok || json?.ok === false) {
        const apiError =
          json?.error || json?.message || rawText || `HTTP ${res.status}`;
        const friendly = getFriendlyEstimateError(
          apiError,
          t(
            "client.newOrder.errors.estimateFailed",
            "Impossible de calculer l’estimation de livraison pour le moment."
          ),
          t
        );

        if (json?.error === "distance_too_far") {
          const dm =
            typeof json.distanceMiles === "number" && !Number.isNaN(json.distanceMiles)
              ? json.distanceMiles
              : null;

          resetEstimateState();
          setEstimateError(
            dm != null
              ? t(
                  "client.newOrder.errors.distanceTooFarWithMiles",
                  `Distance trop grande (${dm.toFixed(2)} mi). Vérifie l’adresse.`
                )
              : friendly
          );

          if (!silent) {
            Alert.alert(
              t("client.newOrder.alerts.blockedTitle", "Commande bloquée"),
              dm != null
                ? t(
                    "client.newOrder.alerts.distanceTooFarWithMiles",
                    `Distance trop grande (${dm.toFixed(
                      2
                    )} mi).\n\nCorrige l'adresse (ZIP / ville / État).`
                  )
                : t(
                    "client.newOrder.alerts.distanceTooFar",
                    "Distance trop grande.\n\nCorrige l'adresse (ZIP / ville / État)."
                  )
            );
          }

          return false;
        }

        resetEstimateState();
        setEstimateError(friendly);

        if (!silent) {
          Alert.alert(t("common.error", "Erreur"), friendly);
        }

        return false;
      }

      if (!json) {
        const friendly = t(
          "client.newOrder.errors.invalidJson",
          "Réponse invalide depuis /api/mapbox/compute-distance (pas du JSON)."
        );

        resetEstimateState();
        setEstimateError(friendly);

        if (!silent) {
          Alert.alert(t("common.error", "Erreur"), friendly);
        }

        return false;
      }

      const dMiles =
        json.distanceMiles ?? json.distance_miles ?? json.distance_miles_est ?? undefined;
      const tMinutes =
        json.etaMinutes ?? json.eta_minutes ?? json.eta_minutes_est ?? undefined;

      if (
        typeof dMiles !== "number" ||
        Number.isNaN(dMiles) ||
        typeof tMinutes !== "number" ||
        Number.isNaN(tMinutes)
      ) {
        const friendly = t(
          "client.newOrder.errors.invalidDistanceTime",
          "Réponse distance/temps invalide depuis l’API Mapbox."
        );

        resetEstimateState();
        setEstimateError(friendly);

        if (!silent) {
          Alert.alert(t("common.error", "Erreur"), friendly);
        }

        return false;
      }

      const BLOCK_MILES = 50;

      if (dMiles > BLOCK_MILES) {
        resetEstimateState();
        setEstimateError(
          t(
            "client.newOrder.errors.distanceTooFarWithMiles",
            `Distance trop grande (${dMiles.toFixed(2)} mi). Vérifie l’adresse.`
          )
        );

        if (!silent) {
          Alert.alert(
            t("client.newOrder.alerts.blockedTitle", "Commande bloquée"),
            t(
              "client.newOrder.alerts.distanceTooFarWithMiles",
              `Distance trop grande (${dMiles.toFixed(
                2
              )} mi).\n\nCorrige l'adresse (ZIP / ville / État).`
            )
          );
        }

        return false;
      }

      const WARN_MILES = 40;

      if (dMiles > WARN_MILES && !silent) {
        Alert.alert(
          t("client.newOrder.alerts.verifyAddressTitle", "⚠️ Adresse à vérifier"),
          t(
            "client.newOrder.alerts.verifyAddressBody",
            `Distance très grande: ${dMiles.toFixed(
              2
            )} mi.\n\nVérifie le ZIP, la ville et l'État.\nEx: "Brooklyn NY 11226".`
          )
        );
      }

      const pLat =
        json.pickupLat ??
        json.pickup_lat ??
        (json.coords as any)?.pickupLat ??
        (json.coords as any)?.pickup_lat ??
        undefined;

      const pLng =
        json.pickupLng ??
        json.pickupLon ??
        json.pickup_lng ??
        (json.coords as any)?.pickupLng ??
        (json.coords as any)?.pickupLon ??
        (json.coords as any)?.pickup_lng ??
        undefined;

      const dLat =
        json.dropoffLat ??
        json.dropoff_lat ??
        (json.coords as any)?.dropoffLat ??
        (json.coords as any)?.dropoff_lat ??
        undefined;

      const dLng =
        json.dropoffLng ??
        json.dropoffLon ??
        json.dropoff_lng ??
        (json.coords as any)?.dropoffLng ??
        (json.coords as any)?.dropoffLon ??
        (json.coords as any)?.dropoff_lng ??
        undefined;

      const pickupOk = hasValidCoordinate(pLat, pLng);
      const dropoffOk = hasValidCoordinate(dLat, dLng);

      const feeFromApi =
        json.delivery_fee_usd?.deliveryFee ??
        json.deliveryPrice?.deliveryFee ??
        json.delivery_fee?.deliveryFee ??
        null;

      const feeLocal = computeDeliveryPricing({
        distanceMiles: dMiles,
        durationMinutes: tMinutes,
      });

      const finalFee =
        typeof feeFromApi === "number" && !Number.isNaN(feeFromApi)
          ? feeFromApi
          : feeLocal;

      setDistanceMiles(dMiles);
      setEtaMinutes(tMinutes);
      setPickupCoords(pickupOk ? { lat: pLat, lng: pLng } : null);
      setDropoffCoords(dropoffOk ? { lat: dLat, lng: dLng } : null);
      setDeliveryFee(roundMoney(finalFee));
      setNewOrderId(null);
      setEstimateError(null);

      return true;
    } catch (err: any) {
      console.error("Erreur estimation livraison mobile:", err);

      if (activeEstimateRequestIdRef.current !== requestId) {
        return false;
      }

      const timeoutLike =
        err?.name === "AbortError" ||
        String(err?.message || "").toLowerCase().includes("network request failed") ||
        String(err?.message || "").toLowerCase().includes("timed out");

      const friendly = timeoutLike
        ? t(
          "client.newOrder.errors.networkFailed",
          "Impossible de joindre le serveur pour le moment. Vérifie le réseau local puis réessaie."
        )
        : getFriendlyEstimateError(
            err?.message,
            t(
              "client.newOrder.errors.estimateFailed",
              "Impossible de calculer l’estimation de livraison pour le moment."
            ),
            t
          );

      resetEstimateState();
      setEstimateError(friendly);

      if (!silent) {
        Alert.alert(t("common.error", "Erreur"), friendly);
      }

      return false;
    } finally {
      if (activeEstimateRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (autoEstimateTimerRef.current) {
      clearTimeout(autoEstimateTimerRef.current);
    }

    if (creating || paying || loading) {
      return;
    }

    if (!addressesReadyForAutoEstimate()) {
      return;
    }

    const pickupValue = normalizeAddress(pickup);
    const dropoffValue = normalizeAddress(dropoff);
    const estimateKey = `${pickupValue}__${dropoffValue}`;

    if (lastEstimateKeyRef.current === estimateKey) {
      return;
    }

    autoEstimateTimerRef.current = setTimeout(() => {
      void handleEstimateDelivery({ silent: true }).then((ok) => {
        if (ok) {
          lastEstimateKeyRef.current = estimateKey;
        }
      });
    }, 1100);

    return () => {
      if (autoEstimateTimerRef.current) {
        clearTimeout(autoEstimateTimerRef.current);
      }
    };
  }, [pickup, dropoff, creating, paying, loading]);

  useEffect(() => {
    return () => {
      if (autoEstimateTimerRef.current) {
        clearTimeout(autoEstimateTimerRef.current);
      }
    };
  }, []);

  async function handleCreateOrder() {
    if (creating || paying) return;

    const pickupValue = normalizeAddress(pickup);
    const dropoffValue = normalizeAddress(dropoff);

    if (!pickupValue || !dropoffValue) {
      Alert.alert(
        t("client.newOrder.alerts.missingFieldsTitle", "Champs manquants"),
        t(
          "client.newOrder.alerts.fillAddressesFirst",
          "Merci de remplir d’abord les adresses pickup et livraison."
        )
      );
      return;
    }

    if (
      !looksLikeCompleteAddress(pickupValue) ||
      !looksLikeCompleteAddress(dropoffValue)
    ) {
      Alert.alert(
        t("client.newOrder.alerts.missingFieldsTitle", "Adresse incomplète"),
        t(
          "client.newOrder.alerts.incompleteAddressCreateBody",
          "Merci d’écrire une adresse complète avant de continuer."
        )
      );
      return;
    }

    if (distanceMiles == null || etaMinutes == null || deliveryFee == null) {
      const ok = await handleEstimateDelivery({ silent: false });
      if (!ok) return;
    }

    if (!pickupCoords || !dropoffCoords) {
      Alert.alert(
        t("client.newOrder.alerts.missingCoordsTitle", "Coordonnées manquantes"),
        t(
          "client.newOrder.alerts.missingCoordsBody",
          "Merci de refaire l’estimation pour récupérer les coordonnées GPS avant de créer la commande."
        )
      );
      return;
    }

    if (
      !hasValidCoordinate(pickupCoords.lat, pickupCoords.lng) ||
      !hasValidCoordinate(dropoffCoords.lat, dropoffCoords.lng)
    ) {
      Alert.alert(
        t("client.newOrder.alerts.missingCoordsTitle", "Coordonnées manquantes"),
        t(
          "client.newOrder.errors.invalidGps",
          "Coordonnées GPS invalides. Refais l’estimation."
        )
      );
      return;
    }

    try {
      setCreating(true);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        Alert.alert(
          t("client.newOrder.alerts.loginRequiredTitle", "Connexion requise"),
          t(
            "client.newOrder.alerts.loginRequiredBody",
            "Merci de te connecter avant de créer une commande."
          )
        );
        return;
      }

      const userId = sessionData.session.user.id;
      const etaMinutesInt = Math.round(etaMinutes ?? 0);

      const r = await resolveRestaurant();

      const safeDeliveryFee = toSafeMoney(deliveryFee ?? 0);
      const safeSubtotal = toSafeMoney(itemsSubtotalFromParams);
      const safeTax = toSafeMoney(taxAmountFromParams);

      const baseOrderTotal = toSafeMoney(baseOrderTotalFromParams);
      const grandTotal = roundMoney(baseOrderTotal + safeDeliveryFee);

      throw new Error(
        t(
          "client.newOrder.errors.legacyDisabled",
          "Direct order creation is disabled. Use the restaurant menu to order food securely."
        )
      );

      const orderPayload = {
        kind: "errand",
        status: "pending",
        restaurant_id: r.restaurant_id,
        restaurant_user_id: r.restaurant_user_id,

        // ✅ Production identity fields
        // client_id is the canonical client owner for orders.
        // user_id and client_user_id are kept for backward compatibility with older code.
        client_id: userId,
        user_id: userId,
        client_user_id: userId,
        created_by: userId,

        pickup_address: r.restaurant_address,
        dropoff_address: dropoffValue,

        distance_miles: distanceMiles,
        eta_minutes: etaMinutesInt,

        delivery_fee: safeDeliveryFee,
        subtotal: safeSubtotal,
        tax: safeTax,
        total: grandTotal,
        currency: "USD",

        pickup_lat: r.restaurant_lat,
        pickup_lng: r.restaurant_lng,
        dropoff_lat: dropoffCoords.lat,
        dropoff_lng: dropoffCoords.lng,

        payment_status: "unpaid",
      };

      const { data, error } = await supabase
        .from("orders")
        .insert(orderPayload)
        .select("id")
        .single();

      if (error) {
        console.error("Erreur insert orders (mobile):", error);
        throw error;
      }

      const createdOrderId = (data?.id as string) || null;

      if (createdOrderId) {
        try {
          const orderMembers = [
            { order_id: createdOrderId, user_id: userId, role: "client" },
          ];

          if (r.restaurant_user_id && r.restaurant_user_id !== userId) {
            orderMembers.push({
              order_id: createdOrderId,
              user_id: r.restaurant_user_id,
              role: "restaurant",
            });
          }

          await supabase.from("order_members").insert(orderMembers);
        } catch (memberErr) {
          console.log("Erreur insert order_members (non bloquant):", memberErr);
        }
      }

      setNewOrderId(createdOrderId);

      Alert.alert(
        t("client.newOrder.alerts.createdTitle", "Commande créée ✅"),
        t(
          "client.newOrder.alerts.createdBody",
          `Ta commande a bien été créée.\n\nID : ${createdOrderId?.slice(
            0,
            8
          )}…\n\nTu peux maintenant appuyer sur “Payer maintenant”.`
        )
      );
    } catch (err: any) {
      console.error("Erreur création commande mobile:", err);
      Alert.alert(
        t("common.error", "Erreur"),
        err?.message ??
          t(
            "client.newOrder.errors.createFailed",
            "Impossible de créer la commande pour le moment."
          )
      );
    } finally {
      setCreating(false);
    }
  }

  async function handlePayNow() {
    if (!newOrderId) {
      Alert.alert(
        t("client.newOrder.alerts.missingOrderTitle", "Commande manquante"),
        t(
          "client.newOrder.alerts.missingOrderBody",
          "Crée d’abord la commande (bouton bleu), ensuite tu pourras payer."
        )
      );
      return;
    }

    if (!cleanApiBaseUrl()) {
      Alert.alert(
        t("client.newOrder.alerts.missingConfigTitle", "Configuration manquante"),
        t(
          "client.newOrder.alerts.missingConfigBody",
          "API_BASE_URL n’est pas configurée. Ajoute EXPO_PUBLIC_WEB_BASE_URL dans app.json."
        )
      );
      return;
    }

    try {
      setPaying(true);

      await payOrderWithPaymentSheet(newOrderId);

      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token?.trim() ?? "";

      if (sessionError || !accessToken) {
        throw new Error(
          t(
            "client.newOrder.errors.missingSession",
            "Session expirée. Reconnecte-toi puis réessaie."
          )
        );
      }

      const confirm = await confirmOrderPaid(newOrderId, accessToken, {
        attempts: 3,
        timeoutMs: 12000,
      });

      if (!confirm.ok) {
        Alert.alert(
          t("client.newOrder.alerts.paymentSuccessTitle", "Paiement réussi ✅"),
          t(
            "client.newOrder.alerts.paymentSuccessBodyWarn",
            "Merci ! Ton paiement Stripe est confirmé.\n\n⚠️ Le serveur n’a pas encore enregistré la commande comme payée. Elle le sera sous peu via Stripe, ou réessaie dans quelques secondes."
          ),
          [{ text: t("common.ok", "OK"), onPress: () => navigation.goBack() }]
        );
        return;
      }

      Alert.alert(
        t("client.newOrder.alerts.paymentSuccessTitle", "Paiement réussi ✅"),
        t(
          "client.newOrder.alerts.paymentSuccessBody",
          "Merci ! Ton paiement est confirmé. Le restaurant pourra accepter la commande."
        ),
        [{ text: t("common.ok", "OK"), onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      console.error("Erreur paiement PaymentSheet:", err);
      Alert.alert(
        t("client.newOrder.alerts.paymentTitle", "Paiement"),
        err?.message ??
          t("client.newOrder.errors.paymentFailed", "Paiement impossible pour le moment.")
      );
    } finally {
      setPaying(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030617" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />

      <ScreenHeader
        title={t("client.newOrder.title", "Nouvelle commande")}
        subtitle={t(
          "client.newOrder.subtitle",
          "Saisie des adresses pickup / dropoff (mobile MMD Delivery) avec la même formule que sur le site web."
        )}
        fallbackRoute="ClientHome"
        variant="dark"
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 28,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              borderRadius: 30,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.06)",
              backgroundColor: "#050a1d",
              padding: 16,
              shadowColor: "#000",
              shadowOpacity: 0.32,
              shadowRadius: 22,
              shadowOffset: { width: 0, height: 10 },
              elevation: 8,
            }}
          >
            <View style={{ marginBottom: 18 }}>
              <Text
                style={{
                  color: "#4ADE80",
                  fontSize: 13,
                  fontWeight: "700",
                  marginBottom: 6,
                  letterSpacing: 0.3,
                }}
              >
                MMD DELIVERY
              </Text>
            </View>

            <View
              style={{
                flexDirection: "row",
                gap: 10,
                marginBottom: 18,
              }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "rgba(59,130,246,0.18)",
                  backgroundColor: "rgba(30,64,175,0.18)",
                  padding: 14,
                }}
              >
                <Text style={{ fontSize: 18, marginBottom: 8 }}>📦</Text>
                <Text style={{ color: "#D1D5DB", fontSize: 12 }}>
                  {t("client.newOrder.cards.autoEstimate", "Estimation auto")}
                </Text>
                <Text style={{ color: "white", fontSize: 16, fontWeight: "900", marginTop: 4 }}>
                  {loading ? t("client.newOrder.status.calculating", "Calcul...") : money(deliveryFee)}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "rgba(251,191,36,0.18)",
                  backgroundColor: "rgba(146,64,14,0.18)",
                  padding: 14,
                }}
              >
                <Text style={{ fontSize: 18, marginBottom: 8 }}>⏱️</Text>
                <Text style={{ color: "#D1D5DB", fontSize: 12 }}>
                  {t("client.newOrder.labels.eta", "Temps estimé")}
                </Text>
                <Text style={{ color: "white", fontSize: 16, fontWeight: "900", marginTop: 4 }}>
                  {loading ? "..." : statValue(orderSummary.eta, " min")}
                </Text>
              </View>

              <View
                style={{
                  flex: 1,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "rgba(52,211,153,0.18)",
                  backgroundColor: "rgba(6,95,70,0.18)",
                  padding: 14,
                }}
              >
                <Text style={{ fontSize: 18, marginBottom: 8 }}>📍</Text>
                <Text style={{ color: "#D1D5DB", fontSize: 12 }}>
                  {t("client.newOrder.labels.distance", "Distance")}
                </Text>
                <Text style={{ color: "white", fontSize: 16, fontWeight: "900", marginTop: 4 }}>
                  {loading ? "..." : orderSummary.distance ? `${orderSummary.distance} mi` : "—"}
                </Text>
              </View>
            </View>

            <View
              style={{
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
                backgroundColor: "rgba(8,12,31,0.96)",
                padding: 16,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: "white",
                  fontSize: 16,
                  fontWeight: "900",
                  marginBottom: 12,
                }}
              >
                {t("client.newOrder.section.addresses", "Adresses de la livraison")}
              </Text>

              <View style={{ marginBottom: 14 }}>
                <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 6 }}>
                  {t("client.newOrder.fields.pickupLabel", "Adresse pickup")}
                </Text>
                <TextInput
                  value={pickup}
                  onChangeText={setPickup}
                  editable={!pickupLocked}
                  placeholder={t(
                    "client.newOrder.fields.pickupPlaceholder",
                    "Ex: 686 Vermont St Brooklyn NY 11207"
                  )}
                  placeholderTextColor="#4B5563"
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={{
                    backgroundColor: pickupLocked ? "#0B1220" : "#020617",
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: pickupLocked ? "#1F2937" : "#374151",
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    color: "white",
                    fontSize: 14,
                  }}
                />
                {pickupLocked && (
                  <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 6 }}>
                    {t(
                      "client.newOrder.fields.pickupLockedHint",
                      "Adresse restaurant remplie automatiquement."
                    )}
                  </Text>
                )}
              </View>

              <View style={{ marginBottom: 6 }}>
                <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 6 }}>
                  {t("client.newOrder.fields.dropoffLabel", "Adresse de livraison")}
                </Text>
                <TextInput
                  value={dropoff}
                  onChangeText={setDropoff}
                  placeholder={t(
                    "client.newOrder.fields.dropoffPlaceholder",
                    "Ex: Adresse du client"
                  )}
                  placeholderTextColor="#4B5563"
                  autoCapitalize="words"
                  autoCorrect={false}
                  style={{
                    backgroundColor: "#020617",
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: "#374151",
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    color: "white",
                    fontSize: 14,
                  }}
                />
              </View>

              <Text
                style={{
                  color: "#94A3B8",
                  fontSize: 11,
                  marginTop: 10,
                  lineHeight: 16,
                }}
              >
                {t(
                  "client.newOrder.hints.autoEstimate",
                  "L’estimation démarre automatiquement après une courte pause quand l’adresse paraît complète."
                )}
              </Text>
            </View>

            <View
              style={{
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
                backgroundColor: "rgba(7,11,28,0.98)",
                padding: 16,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: "white",
                  fontSize: 16,
                  fontWeight: "900",
                  marginBottom: 10,
                }}
              >
                {t(
                  "client.newOrder.section.estimateTitle",
                  "Estimation livraison (MMD Delivery)"
                )}
              </Text>

              {loading ? (
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
                  <ActivityIndicator size="small" color="#22C55E" />
                  <Text style={{ color: "#D1FAE5", fontSize: 12, fontWeight: "700", marginLeft: 8 }}>
                    {t("client.newOrder.status.autoCalculating", "Calcul automatique en cours...")}
                  </Text>
                </View>
              ) : estimateError ? (
                <Text style={{ color: "#FCA5A5", fontSize: 12, fontWeight: "700", marginBottom: 8 }}>
                  {estimateError}
                </Text>
              ) : (
                <Text style={{ color: "#86EFAC", fontSize: 12, fontWeight: "700", marginBottom: 8 }}>
                  {distanceMiles != null && etaMinutes != null && deliveryFee != null
                    ? t("client.newOrder.status.estimateReady", "Estimation prête.")
                    : t("client.newOrder.status.waitingCompleteAddress", "En attente d’une adresse complète.")}
                </Text>
              )}

              <View style={{ gap: 6 }}>
                <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                  {t("client.newOrder.labels.distance", "Distance")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {distanceMiles != null ? `${distanceMiles.toFixed(2)} mi` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                  {t("client.newOrder.labels.eta", "Temps estimé")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {etaMinutes != null ? `${Math.round(etaMinutes)} min` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                  {t("client.newOrder.labels.itemsSubtotal", "Sous-total articles")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {money(orderSummary.itemsSubtotal)}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                  {t("client.newOrder.labels.taxes", "Taxes")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {money(orderSummary.taxAmount)}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                  {t("client.newOrder.labels.fee", "Frais de livraison")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                    {deliveryFee != null ? `${deliveryFee.toFixed(2)} USD` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                  {t("client.newOrder.labels.finalTotal", "Total final")} :{" "}
                  <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
                    {money(orderSummary.finalTotal)}
                  </Text>
                </Text>

                <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 6 }}>
                  {t("client.newOrder.labels.pickupGps", "Pickup GPS")} :{" "}
                  {pickupCoords
                    ? `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}`
                    : "—"}
                </Text>

                <Text style={{ color: "#6B7280", fontSize: 11 }}>
                  {t("client.newOrder.labels.dropoffGps", "Dropoff GPS")} :{" "}
                  {dropoffCoords
                    ? `${dropoffCoords.lat.toFixed(5)}, ${dropoffCoords.lng.toFixed(5)}`
                    : "—"}
                </Text>
              </View>
            </View>

            <View
              style={{
                borderRadius: 24,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)",
                backgroundColor: "rgba(7,11,28,0.98)",
                padding: 16,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: "white",
                  fontSize: 16,
                  fontWeight: "900",
                  marginBottom: 12,
                }}
              >
                {t("client.newOrder.checkout.title", "Checkout flow")}
              </Text>

              <View style={{ gap: 10 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor:
                        distanceMiles != null && etaMinutes != null && deliveryFee != null
                          ? "#16A34A"
                          : "#1F2937",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>1</Text>
                  </View>
                  <Text style={{ color: "#D1D5DB", fontSize: 13 }}>
                    {t("client.newOrder.checkout.stepEstimate", "Estimation automatique")}
                  </Text>
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: newOrderId ? "#16A34A" : "#1F2937",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>2</Text>
                  </View>
                  <Text style={{ color: "#D1D5DB", fontSize: 13 }}>
                    {t("client.newOrder.checkout.stepCreate", "Créer la commande")}
                  </Text>
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: canPay ? "#F59E0B" : "#1F2937",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ color: "white", fontWeight: "900" }}>3</Text>
                  </View>
                  <Text style={{ color: "#D1D5DB", fontSize: 13 }}>
                    {t("client.newOrder.checkout.stepPay", "Payer avec Stripe")}
                  </Text>
                </View>
              </View>
            </View>

            <TouchableOpacity
              onPress={handleCreateOrder}
              disabled={!canCreate}
              style={{
                backgroundColor: !canCreate ? "#4B5563" : "#3B82F6",
                borderRadius: 999,
                paddingVertical: 14,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                marginBottom: 10,
              }}
              activeOpacity={0.85}
            >
              {creating && <ActivityIndicator color="#ffffff" />}
              <Text
                style={{
                  color: "white",
                  fontSize: 14,
                  fontWeight: "800",
                  marginLeft: creating ? 8 : 0,
                }}
              >
                {creating
                  ? t("client.newOrder.actions.creating", "Création commande...")
                  : t("client.newOrder.actions.create", "Confirmer et créer la commande MMD")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handlePayNow}
              disabled={!canPay}
              style={{
                backgroundColor: !canPay ? "#4B5563" : "#F59E0B",
                borderRadius: 999,
                paddingVertical: 14,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
              }}
              activeOpacity={0.85}
            >
              {paying && <ActivityIndicator color="#ffffff" />}
              <Text
                style={{
                  color: "white",
                  fontSize: 14,
                  fontWeight: "900",
                  marginLeft: paying ? 8 : 0,
                }}
              >
                {paying
                  ? t("client.newOrder.actions.paying", "Paiement en cours...")
                  : t("client.newOrder.actions.payNow", "Payer maintenant 💳")}
              </Text>
            </TouchableOpacity>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: 11,
                textAlign: "center",
                marginTop: 10,
                lineHeight: 16,
              }}
            >
              {t(
                "client.newOrder.footer.steps",
                "1) Estime → 2) Crée la commande → 3) Paye avec Stripe PaymentSheet."
              )}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default ClientNewOrderScreen;
