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
import { payOrderWithPaymentSheet } from "../utils/stripe";

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

console.log("MMD MOBILE API_BASE_URL =", API_BASE_URL);

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
  rawMessage?: string,
  fallback = "Impossible de calculer l’estimation de livraison pour le moment."
) {
  const text = String(rawMessage || "").trim();
  const lower = text.toLowerCase();

  if (!text) return fallback;

  if (lower.includes("route exceeds maximum distance limitation")) {
    return "Distance trop grande ou adresse trop imprécise. Vérifie la rue, le ZIP code, la ville et l’État.";
  }

  if (lower.includes("aucune route trouvée")) {
    return "Aucune route trouvée entre ces adresses. Vérifie l’adresse de destination.";
  }

  if (lower.includes("network request failed")) {
    return "Impossible de joindre le serveur pour le moment. Vérifie le réseau local puis réessaie.";
  }

  if (lower.includes("timed out") || lower.includes("abort")) {
    return "La requête d’estimation a pris trop de temps. Réessaie dans un instant.";
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

export function ClientNewOrderScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<any>();
  const { t } = useTranslation();

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
    distanceMiles != null &&
    etaMinutes != null &&
    deliveryFee != null;

  const canPay = !paying && !!newOrderId;

  /**
   * ✅ Totaux venant éventuellement de l’écran précédent
   * On accepte plusieurs noms possibles pour éviter de casser le flow existant.
   */
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
    restaurant_user_id: string | null;
  }> {
    if (restaurantIdFromParams) {
      const { data: rp, error } = await supabase
        .from("restaurant_profiles")
        .select("user_id")
        .eq("user_id", restaurantIdFromParams)
        .maybeSingle();

      if (error) {
        console.log("resolveRestaurant user_id fetch error:", error);
      }

      return {
        restaurant_id: restaurantIdFromParams,
        restaurant_user_id: (rp as any)?.user_id ?? restaurantIdFromParams,
      };
    }

    const { data, error } = await supabase
      .from("restaurant_profiles")
      .select("user_id,status")
      .eq("status", "approved")
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      throw new Error(
        t(
          "client.newOrder.errors.noApprovedRestaurant",
          "Aucun restaurant approuvé trouvé. Va approuver un restaurant dans Supabase (restaurant_profiles.status='approved')."
        )
      );
    }

    return {
      restaurant_id: (data as any).user_id,
      restaurant_user_id: (data as any).user_id,
    };
  }

  async function notifyBackendPaymentSuccess(orderId: string) {
    if (!API_BASE_URL) return;

    const url = `${API_BASE_URL}/api/stripe/mark-paid`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });

      const text = await res.text();
      if (!res.ok) {
        console.log("mark-paid failed:", res.status, text);
        return { ok: false, message: text || `HTTP ${res.status}` };
      }

      return { ok: true, message: text };
    } catch (e: any) {
      console.log("mark-paid error:", e?.message ?? e);
      return { ok: false, message: e?.message ?? "Network error" };
    }
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
          "Merci de saisir des adresses plus complètes avant le calcul."
        );
      }
      return false;
    }

    if (!API_BASE_URL) {
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

      const url = `${API_BASE_URL}/api/mapbox/compute-distance`;
      console.log("MMD MOBILE fetch distance →", url);

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
      clearTimeout(timeout);

      console.log("MMD MOBILE distance raw =", rawText);

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
          )
        );

        if (json?.error === "distance_too_far") {
          const dm =
            typeof json.distanceMiles === "number" && !Number.isNaN(json.distanceMiles)
              ? json.distanceMiles
              : null;

          resetEstimateState();
          setEstimateError(
            dm != null
              ? `Distance trop grande (${dm.toFixed(2)} mi). Vérifie l’adresse.`
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

      console.log("✅ API Mapbox mobile OK (JSON):", json);

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
          `Distance trop grande (${dMiles.toFixed(2)} mi). Vérifie l’adresse.`
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

      const pickupOk =
        typeof pLat === "number" &&
        typeof pLng === "number" &&
        !Number.isNaN(pLat) &&
        !Number.isNaN(pLng);

      const dropoffOk =
        typeof dLat === "number" &&
        typeof dLng === "number" &&
        !Number.isNaN(dLat) &&
        !Number.isNaN(dLng);

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
      setDeliveryFee(finalFee);
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
        ? "Impossible de joindre le serveur pour le moment. Vérifie le réseau local puis réessaie."
        : getFriendlyEstimateError(
            err?.message,
            t(
              "client.newOrder.errors.estimateFailed",
              "Impossible de calculer l’estimation de livraison pour le moment."
            )
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
        "Merci d’écrire une adresse complète avant de continuer."
      );
      return;
    }

    if (distanceMiles == null || etaMinutes == null || deliveryFee == null) {
      const ok = await handleEstimateDelivery({ silent: false });
      if (!ok) return;
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
      const totalCents = Math.round(grandTotal * 100);

      const orderPayload = {
        type: "errand",
        status: "pending",
        restaurant_id: r.restaurant_id,
        restaurant_user_id: r.restaurant_user_id,
        client_user_id: userId,
        created_by: userId,

        pickup_address: pickupValue,
        dropoff_address: dropoffValue,

        distance_miles: distanceMiles,
        eta_minutes: etaMinutesInt,

        delivery_fee: safeDeliveryFee,
        subtotal: safeSubtotal,
        tax: safeTax,
        total: grandTotal,
        grand_total: grandTotal,
        total_cents: totalCents,
        currency: "USD",

        pickup_lat: pickupCoords?.lat ?? null,
        pickup_lng: pickupCoords?.lng ?? null,
        dropoff_lat: dropoffCoords?.lat ?? null,
        dropoff_lng: dropoffCoords?.lng ?? null,

        payment_status: "unpaid",
      };

      console.log("MMD create order payload =", orderPayload);

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

    if (!API_BASE_URL) {
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

      const mark = await notifyBackendPaymentSuccess(newOrderId);

      if (!mark?.ok) {
        Alert.alert(
          t("client.newOrder.alerts.paymentSuccessTitle", "Paiement réussi ✅"),
          t(
            "client.newOrder.alerts.paymentSuccessBodyWarn",
            "Merci ! Ton paiement est confirmé.\n\n⚠️ Le serveur n’a pas encore marqué la commande comme payée automatiquement. Assure-toi que le webhook Stripe ou /api/stripe/mark-paid est en place."
          ),
          [{ text: "OK", onPress: () => navigation.goBack() }]
        );
        return;
      }

      Alert.alert(
        t("client.newOrder.alerts.paymentSuccessTitle", "Paiement réussi ✅"),
        t(
          "client.newOrder.alerts.paymentSuccessBody",
          "Merci ! Ton paiement est confirmé. Le restaurant pourra accepter la commande."
        ),
        [{ text: "OK", onPress: () => navigation.goBack() }]
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
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030617" }} edges={["top"]}>
      <StatusBar barStyle="light-content" />

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

              <Text
                style={{
                  color: "white",
                  fontSize: 26,
                  fontWeight: "900",
                  lineHeight: 32,
                }}
              >
                {t("client.newOrder.title", "Nouvelle commande")}
              </Text>

              <Text
                style={{
                  color: "#9CA3AF",
                  fontSize: 14,
                  lineHeight: 20,
                  marginTop: 8,
                }}
              >
                {t(
                  "client.newOrder.subtitle",
                  "Saisie des adresses pickup / dropoff (mobile MMD Delivery) avec la même formule que sur le site web."
                )}
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
                  Estimation auto
                </Text>
                <Text style={{ color: "white", fontSize: 16, fontWeight: "900", marginTop: 4 }}>
                  {loading ? "Calcul..." : money(deliveryFee)}
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
                    Adresse restaurant remplie automatiquement.
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
                L’estimation démarre automatiquement après une courte pause quand l’adresse paraît complète.
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
                    Calcul automatique en cours...
                  </Text>
                </View>
              ) : estimateError ? (
                <Text style={{ color: "#FCA5A5", fontSize: 12, fontWeight: "700", marginBottom: 8 }}>
                  {estimateError}
                </Text>
              ) : (
                <Text style={{ color: "#86EFAC", fontSize: 12, fontWeight: "700", marginBottom: 8 }}>
                  {distanceMiles != null && etaMinutes != null && deliveryFee != null
                    ? "Estimation prête."
                    : "En attente d’une adresse complète."}
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
                  Sous-total articles :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {money(orderSummary.itemsSubtotal)}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
                  Taxes :{" "}
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
                  Total final :{" "}
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
                Checkout flow
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
                    Estimation automatique
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
                    Créer la commande
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
                    Payer avec Stripe
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

          <View style={{ marginTop: 16 }}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: "#4B5563",
                alignItems: "center",
              }}
              activeOpacity={0.85}
            >
              <Text style={{ color: "#E5E7EB", fontSize: 13, fontWeight: "600" }}>
                ← {t("client.newOrder.actions.backToClient", "Retour à l’espace client")}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}