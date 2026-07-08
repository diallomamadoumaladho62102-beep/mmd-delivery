import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Image,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { API_BASE_URL } from "../lib/apiBase";
import { startCheckoutForOrder } from "../../lib/payments";
import { createFoodOrder, quoteFoodOrder, type FoodOrderPricingPayload } from "../lib/foodOrderApi";
import { fetchMapboxComputeDistance } from "../lib/mapboxComputeDistance";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import { useClientPlatformFeatures } from "../hooks/useClientPlatformFeatures";
import { resolveMarketScopeFromFeatures } from "../lib/marketScope";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientRestaurantMenu">;
type Route = RouteProp<RootStackParamList, "ClientRestaurantMenu">;

type RestaurantItem = {
  id: string;
  name: string;
  description: string | null;
  price_cents: number | null;
  category?: string | null;
  restaurant_user_id: string;
  image_url: string | null;
  is_available?: boolean | null;
  position?: number | null;
};

type RestaurantProfile = {
  user_id: string;
  restaurant_name: string | null;
  address: string | null;
  status: string | null;
  is_accepting_orders: boolean | null;
  location_lat: number | string | null;
  location_lng: number | string | null;
};


type CartItem = {
  id: string;
  name: string;
  category: string | null;
  unit_price: number;
  quantity: number;
  image_url: string | null;
};

type ApiDeliveryPrice = {
  deliveryFee: number;
  platformFee: number;
  driverPayout: number;
};

type ApiCoords = {
  pickupLat?: number;
  pickupLng?: number;
  pickupLon?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  dropoffLon?: number;
};

type MapboxDistanceResponse = {
  ok?: boolean;
  error?: string;
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
  pickup_lon?: number;
  dropoff_lat?: number;
  dropoff_lng?: number;
  dropoff_lon?: number;
  coords?: ApiCoords;
  raw?: {
    distance_meters: number;
    duration_seconds: number;
  };
};

function computeDeliveryPricing({
  distanceMiles,
  durationMinutes,
}: {
  distanceMiles: number;
  durationMinutes: number;
}): number {
  const BASE_FARE = 2.5;
  const PER_MILE = 0.9;
  const PER_MINUTE = 0.15;
  const MIN_FARE = 3.49;

  const raw = BASE_FARE + distanceMiles * PER_MILE + durationMinutes * PER_MINUTE;
  const rounded = Math.round(raw * 100) / 100;
  return Math.max(MIN_FARE, rounded);
}

function money(n: number) {
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

function normalizeAddress(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isAddressReady(value: string) {
  const v = normalizeAddress(value);
  return v.length >= 10 && /\d/.test(v) && v.includes(" ");
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

function cleanApiBaseUrl() {
  const raw = String(API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : "";
}

function normalizeRestaurantItem(row: any): RestaurantItem | null {
  const id = String(row?.id || "").trim();
  const name = String(row?.name || "").trim();
  const restaurantUserId = String(row?.restaurant_user_id || "").trim();
  const priceCents = Number(row?.price_cents ?? 0);

  if (!id || !name || !restaurantUserId) return null;
  if (!Number.isFinite(priceCents) || priceCents <= 0) return null;

  return {
    id,
    name,
    description: row?.description ?? null,
    price_cents: priceCents,
    category: row?.category ?? null,
    restaurant_user_id: restaurantUserId,
    image_url: String(row?.image_url || "").trim() || null,
    is_available: row?.is_available ?? true,
    position: row?.position ?? null,
  };
}

function getFriendlyEstimateError(
  message: string | undefined,
  tr: (key: string, fallback: string) => string
) {
  const raw = String(message || "").trim();

  if (!raw) {
    return tr(
      "clientRestaurantMenu.estimate.errors.generic",
      "Impossible de calculer la livraison pour le moment."
    );
  }

  const lower = raw.toLowerCase();

  if (lower.includes("route exceeds maximum distance limitation")) {
    return tr(
      "clientRestaurantMenu.estimate.errors.tooFarOrImprecise",
      "Destination trop éloignée ou adresse pas assez précise. Vérifie la rue, le ZIP code, la ville et l’État."
    );
  }

  if (lower.includes("aucune route trouvée") || lower.includes("no route")) {
    return tr(
      "clientRestaurantMenu.estimate.errors.noRoute",
      "Aucun itinéraire de livraison trouvé pour cette destination. Vérifie l’adresse."
    );
  }

  if (lower.includes("abort") || lower.includes("timed out")) {
    return tr(
      "clientRestaurantMenu.estimate.errors.timeout",
      "La demande d’estimation a pris trop de temps. Réessaie."
    );
  }

  return raw;
}

export function ClientRestaurantMenuScreen() {
  const { t } = useTranslation();

  const tr = useCallback(
    (key: string, fallback: string) => t(key, { defaultValue: fallback }),
    [t]
  );

  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();

  const routeParams = route.params as Route["params"] & {
    restaurantAddress?: string;
    pickupAddress?: string;
  };

  const { restaurantId, restaurantName } = routeParams;
  const restaurantAddressFromRoute = normalizeAddress(
    routeParams.restaurantAddress ?? routeParams.pickupAddress ?? ""
  );

  const [items, setItems] = useState<RestaurantItem[]>([]);
  const [restaurantProfile, setRestaurantProfile] = useState<RestaurantProfile | null>(null);
  const [loading, setLoading] = useState(false);

  const [cart, setCart] = useState<CartItem[]>([]);

  const [pickup, setPickup] = useState(restaurantAddressFromRoute);
  const [dropoff, setDropoff] = useState("");

  const [distanceMiles, setDistanceMiles] = useState<number | null>(null);
  const [etaMinutes, setEtaMinutes] = useState<number | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState<string | null>(null);

  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [leaveAtDoor, setLeaveAtDoor] = useState(false);

  const [creating, setCreating] = useState(false);
  const [serverPricing, setServerPricing] = useState<FoodOrderPricingPayload | null>(null);

  const { features: platformFeatures } = useClientPlatformFeatures();
  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );
  const currency = market.scopeResolved
    ? market.currencyCode
    : platformFeatures.scope?.country_code
      ? resolveMarketScopeFromFeatures({
          ...platformFeatures,
          ok: true,
          country_code: platformFeatures.scope.country_code,
        }).currencyCode
      : "USD";

  const autoEstimateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEstimateKeyRef = useRef<string>("");
  const activeEstimateRequestIdRef = useRef(0);

  const pickupLocked = !!restaurantAddressFromRoute;

  useEffect(() => {
    if (!restaurantId) {
      Alert.alert(
        tr("common.error.title", "Erreur"),
        tr(
          "clientRestaurantMenu.errors.missingRestaurantId",
          "Restaurant introuvable. Retourne à la liste des restaurants puis réessaie."
        )
      );
    }
  }, [restaurantId, tr]);

  function getItemPrice(item: RestaurantItem): number {
    const cents = Number(item.price_cents ?? 0);
    if (Number.isFinite(cents) && cents > 0) return cents / 100;
    return 0;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadRestaurantAndMenu() {
      try {
        if (!cancelled) setLoading(true);

        if (!restaurantId) {
          if (!cancelled) {
            setRestaurantProfile(null);
            setItems([]);
          }
          return;
        }

        const { data: profileData, error: profileError } = await supabase
          .from("restaurant_profiles")
          .select(
            "user_id, restaurant_name, address, status, is_accepting_orders, location_lat, location_lng"
          )
          .eq("user_id", restaurantId)
          .eq("status", "approved")
          .eq("is_accepting_orders", true)
          .maybeSingle();

        if (profileError) throw profileError;

        const profile = (profileData as RestaurantProfile | null) ?? null;
        const profileAddress = normalizeAddress(String(profile?.address || ""));
        const hasValidProfile =
          !!profile &&
          !!profile.user_id &&
          !!profileAddress &&
          isValidCoordinate(profile.location_lat, profile.location_lng);

        if (!hasValidProfile) {
          if (!cancelled) {
            setRestaurantProfile(null);
            setItems([]);
            resetEstimateState();
            Alert.alert(
              tr("common.error.title", "Erreur"),
              tr(
                "clientRestaurantMenu.errors.restaurantUnavailable",
                "Ce restaurant n’est pas disponible ou son adresse GPS n’est pas encore configurée."
              )
            );
          }
          return;
        }

        if (!cancelled) {
          setRestaurantProfile(profile);
          setPickup(profileAddress);
        }

        const { data, error } = await supabase
          .from("restaurant_items")
          .select(
            "id, name, description, price_cents, category, restaurant_user_id, image_url, is_available, position"
          )
          .eq("restaurant_user_id", restaurantId)
          .eq("is_available", true)
          .order("position", { ascending: true, nullsFirst: false })
          .order("name", { ascending: true });

        if (error) throw error;

        const safeItems = ((data || []) as any[])
          .map(normalizeRestaurantItem)
          .filter(Boolean) as RestaurantItem[];

        if (!cancelled) setItems(safeItems);
      } catch (err) {
        console.error("Erreur fetch menu restaurant (mobile):", err);
        if (!cancelled) {
          setRestaurantProfile(null);
          setItems([]);
          Alert.alert(
            tr("common.error.title", "Erreur"),
            tr(
              "clientRestaurantMenu.loadMenuError",
              "Impossible de charger le menu de ce restaurant pour le moment."
            )
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadRestaurantAndMenu();

    return () => {
      cancelled = true;
    };
  }, [restaurantId, tr]);

  function resetEstimateState() {
    setDistanceMiles(null);
    setEtaMinutes(null);
    setDeliveryFee(null);
    setPickupCoords(null);
    setDropoffCoords(null);
    setEstimateError(null);
  }

  useEffect(() => {
    resetEstimateState();
    lastEstimateKeyRef.current = "";
  }, [pickup, dropoff]);

  function addToCart(item: RestaurantItem) {
    const price = getItemPrice(item);

    if (!item.is_available || price <= 0) {
      Alert.alert(
        tr("common.error.title", "Erreur"),
        tr(
          "clientRestaurantMenu.menu.itemUnavailable",
          "Ce plat n’est plus disponible pour le moment."
        )
      );
      return;
    }

    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }

      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          category: item.category ?? null,
          unit_price: price,
          quantity: 1,
          image_url: item.image_url ?? null,
        },
      ];
    });
  }

  function updateQuantity(id: string, quantity: number) {
    const safeQuantity = Math.max(0, Math.min(99, Math.floor(Number(quantity) || 0)));

    setCart((prev) =>
      prev
        .map((c) => (c.id === id ? { ...c, quantity: safeQuantity } : c))
        .filter((c) => c.quantity > 0)
    );
  }

  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((c) => c.id !== id));
  }

  const subtotal = useMemo(
    () => roundMoney(cart.reduce((sum, item) => sum + item.unit_price * item.quantity, 0)),
    [cart]
  );

  const tax = useMemo(() => roundMoney(subtotal * 0.0888), [subtotal]);

  const totalBeforeDelivery = useMemo(() => roundMoney(subtotal + tax), [subtotal, tax]);

  const finalGrandTotal = useMemo(
    () => roundMoney(totalBeforeDelivery + (deliveryFee ?? 0)),
    [totalBeforeDelivery, deliveryFee]
  );

  const displaySubtotal = serverPricing?.subtotal ?? subtotal;
  const displayTax = serverPricing?.tax ?? tax;
  const displayTaxRatePct = serverPricing?.tax_rate_pct ?? 8.88;
  const displayDeliveryFee = serverPricing?.delivery_fee ?? deliveryFee;
  const displayServiceFee = serverPricing?.service_fee ?? 0;
  const displayGrandTotal =
    serverPricing?.total ??
    roundMoney(
      (serverPricing?.subtotal ?? subtotal) +
        (serverPricing?.tax ?? tax) +
        (displayDeliveryFee ?? 0) +
        displayServiceFee
    );

  async function refreshServerQuote(
    pickupValue: string,
    dropoffValue: string,
    coords: { pickup: { lat: number; lng: number }; dropoff: { lat: number; lng: number } }
  ) {
    if (!restaurantId || cart.length === 0) {
      setServerPricing(null);
      return;
    }

    try {
      const quote = await quoteFoodOrder(
        {
          restaurant_id: restaurantId,
          restaurant_name: restaurantProfile?.restaurant_name || restaurantName,
          pickup_address: pickupValue,
          dropoff_address: dropoffValue,
          pickup_lat: coords.pickup.lat,
          pickup_lng: coords.pickup.lng,
          dropoff_lat: coords.dropoff.lat,
          dropoff_lng: coords.dropoff.lng,
          items: cart.map((item) => ({
            item_id: item.id,
            quantity: item.quantity,
          })),
        },
        {
          countryCode: market.countryCode,
          lat: coords.dropoff.lat,
          lng: coords.dropoff.lng,
        }
      );
      setServerPricing(quote);
      setDeliveryFee(roundMoney(quote.delivery_fee));
    } catch (err) {
      console.warn("[ClientRestaurantMenu] server quote failed:", err);
      setServerPricing(null);
    }
  }

  async function handleEstimateDelivery(options?: { silent?: boolean }) {
    const silent = options?.silent === true;

    const pickupValue = normalizeAddress(pickup);
    const dropoffValue = normalizeAddress(dropoff);

    if (estimating) {
      return false;
    }

    if (!restaurantProfile) {
      Alert.alert(
        tr("common.error.title", "Erreur"),
        tr(
          "clientRestaurantMenu.errors.restaurantUnavailable",
          "Ce restaurant n’est pas disponible ou son adresse GPS n’est pas encore configurée."
        )
      );
      return;
    }

    if (cart.length === 0) {
      if (!silent) {
        Alert.alert(
          tr("clientRestaurantMenu.cartEmptyTitle", "Panier vide"),
          tr("clientRestaurantMenu.cartEmptyEstimate", "Ajoute au moins un plat avant l’estimation.")
        );
      }
      return false;
    }

    if (!pickupValue || !dropoffValue) {
      if (!silent) {
        Alert.alert(
          tr("clientRestaurantMenu.missingFieldsTitle", "Champs manquants"),
          tr(
            "clientRestaurantMenu.missingFieldsEstimate",
            "Merci de saisir l’adresse pickup (restaurant) et l’adresse de livraison."
          )
        );
      }
      return false;
    }

    if (!isAddressReady(pickupValue) || !isAddressReady(dropoffValue)) {
      if (!silent) {
        Alert.alert(
          tr("clientRestaurantMenu.incompleteAddressTitle", "Adresse incomplète"),
          tr(
            "clientRestaurantMenu.incompleteAddressBody",
            "Merci de saisir une adresse plus complète avant de calculer la livraison."
          )
        );
      }
      return false;
    }

    const apiBaseUrl = cleanApiBaseUrl();

    if (!apiBaseUrl) {
      if (!silent) {
        Alert.alert(
          tr("clientRestaurantMenu.missingConfigTitle", "Configuration manquante"),
          tr("clientRestaurantMenu.missingConfigBody", "API_BASE_URL n’est pas configurée.")
        );
      }
      return false;
    }

    const requestId = Date.now();
    activeEstimateRequestIdRef.current = requestId;

    try {
      setEstimating(true);
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
        json = rawText ? (JSON.parse(rawText) as MapboxDistanceResponse) : null;
      } catch {
        json = null;
      }

      if (activeEstimateRequestIdRef.current !== requestId) {
        return false;
      }

      const apiErrorMessage = getFriendlyEstimateError(json?.error || rawText, tr);

      if (!res.ok || json?.ok === false) {
        resetEstimateState();
        setEstimateError(apiErrorMessage);

        if (!silent) {
          Alert.alert(
            tr("common.error.title", "Erreur"),
            apiErrorMessage ||
              tr(
                "clientRestaurantMenu.estimateError",
                "Impossible de calculer l’estimation de livraison pour le moment."
              )
          );
        }

        return false;
      }

      if (!json) {
        resetEstimateState();
        setEstimateError(
          tr(
            "clientRestaurantMenu.estimate.errors.invalidResponse",
            "Réponse invalide du service d’estimation de livraison."
          )
        );

        if (!silent) {
          Alert.alert(
            tr("common.error.title", "Erreur"),
            tr(
            "clientRestaurantMenu.estimate.errors.invalidApiResponse",
            "Réponse invalide depuis /api/mapbox/compute-distance."
          )
          );
        }

        return false;
      }

      const dMiles =
        json.distanceMiles ?? json.distance_miles ?? json.distance_miles_est ?? undefined;

      const tMinutes = json.etaMinutes ?? json.eta_minutes ?? json.eta_minutes_est ?? undefined;

      if (
        typeof dMiles !== "number" ||
        Number.isNaN(dMiles) ||
        typeof tMinutes !== "number" ||
        Number.isNaN(tMinutes)
      ) {
        resetEstimateState();
        setEstimateError(
          tr(
            "clientRestaurantMenu.estimate.errors.invalidDistanceEta",
            "Distance ou temps estimé invalide reçu depuis le service d’estimation."
          )
        );

        if (!silent) {
          Alert.alert(
            tr("common.error.title", "Erreur"),
            tr(
            "clientRestaurantMenu.estimate.errors.invalidMapboxDistanceEta",
            "Réponse distance/temps invalide depuis l’API Mapbox."
          )
          );
        }
        return false;
      }

      const BLOCK_MILES = 50;
      if (dMiles > BLOCK_MILES) {
        resetEstimateState();
        setEstimateError(
          tr(
            "clientRestaurantMenu.estimate.errors.distanceTooLarge",
            `Distance trop grande (${dMiles.toFixed(
              2
            )} mi). Vérifie le ZIP code, la ville et l’État.`
          )
        );

        if (!silent) {
          Alert.alert(
            tr("clientRestaurantMenu.orderBlockedTitle", "Commande bloquée"),
            tr(
              "clientRestaurantMenu.orderBlockedBody",
              `Distance trop grande (${dMiles.toFixed(
                2
              )} mi).\n\nCorrige l'adresse (ZIP / ville / État).`
            )
          );
        }
        return false;
      }

      const pLat = json.pickupLat ?? json.pickup_lat ?? json.coords?.pickupLat ?? undefined;
      const pLng =
        json.pickupLng ??
        json.pickupLon ??
        json.pickup_lng ??
        json.coords?.pickupLng ??
        json.coords?.pickupLon ??
        undefined;

      const dLat = json.dropoffLat ?? json.dropoff_lat ?? json.coords?.dropoffLat ?? undefined;
      const dLng =
        json.dropoffLng ??
        json.dropoffLon ??
        json.dropoff_lng ??
        json.coords?.dropoffLng ??
        json.coords?.dropoffLon ??
        undefined;

      const pickupOk = isValidCoordinate(pLat, pLng);
      const dropoffOk = isValidCoordinate(dLat, dLng);

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
        typeof feeFromApi === "number" && !Number.isNaN(feeFromApi) ? feeFromApi : feeLocal;

      setDistanceMiles(dMiles);
      setEtaMinutes(tMinutes);
      setDeliveryFee(roundMoney(finalFee));
      setPickupCoords(pickupOk ? { lat: pLat!, lng: pLng! } : null);
      setDropoffCoords(dropoffOk ? { lat: dLat!, lng: dLng! } : null);
      setEstimateError(null);

      if (pickupOk && dropoffOk && cart.length > 0) {
        void refreshServerQuote(
          pickupValue,
          dropoffValue,
          {
            pickup: { lat: pLat!, lng: pLng! },
            dropoff: { lat: dLat!, lng: dLng! },
          }
        );
      }

      const WARN_MILES = 40;
      if (dMiles > WARN_MILES && !silent) {
        Alert.alert(
          tr("clientRestaurantMenu.verifyAddressTitle", "⚠️ Adresse à vérifier"),
          tr(
            "clientRestaurantMenu.verifyAddressBody",
            `Distance très grande: ${dMiles.toFixed(
              2
            )} mi.\n\nVérifie le ZIP, la ville et l'État.\nEx: "Brooklyn NY 11226".`
          )
        );
      }

      return true;
    } catch (err: any) {
      console.error("Erreur estimation livraison restaurant (mobile):", err);

      if (activeEstimateRequestIdRef.current !== requestId) {
        return false;
      }

      const timeoutLike =
        err?.name === "AbortError" ||
        String(err?.message || "").toLowerCase().includes("timed out");

      const message = timeoutLike
        ? tr(
          "clientRestaurantMenu.estimate.errors.timeout",
          "La demande d’estimation a pris trop de temps. Réessaie."
        )
        : getFriendlyEstimateError(
            err?.message ??
              tr(
                "clientRestaurantMenu.estimateError",
                "Impossible de calculer l’estimation de livraison pour le moment."
              ),
            tr
          );

      resetEstimateState();
      setEstimateError(message);

      if (!silent) {
        Alert.alert(tr("common.error.title", "Erreur"), message);
      }

      return false;
    } finally {
      if (activeEstimateRequestIdRef.current === requestId) {
        setEstimating(false);
      }
    }
  }

  useEffect(() => {
    if (autoEstimateTimerRef.current) {
      clearTimeout(autoEstimateTimerRef.current);
    }

    const pickupValue = normalizeAddress(pickup);
    const dropoffValue = normalizeAddress(dropoff);

    const canEstimate =
      !creating &&
      cart.length > 0 &&
      isAddressReady(pickupValue) &&
      isAddressReady(dropoffValue);

    if (!canEstimate) {
      return;
    }

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
  }, [pickup, dropoff, cart.length, creating]);

  useEffect(() => {
    return () => {
      if (autoEstimateTimerRef.current) {
        clearTimeout(autoEstimateTimerRef.current);
      }
    };
  }, []);

  async function handleCreateOrder() {
    if (!restaurantId) {
      Alert.alert(
        tr("common.error.title", "Erreur"),
        tr(
          "clientRestaurantMenu.errors.missingRestaurantId",
          "Restaurant introuvable. Retourne à la liste des restaurants puis réessaie."
        )
      );
      return;
    }

    if (cart.length === 0) {
      Alert.alert(
        tr("clientRestaurantMenu.cartEmptyTitle", "Panier vide"),
        tr("clientRestaurantMenu.cartEmptyCreate", "Ajoute au moins un plat à ta commande.")
      );
      return;
    }

    if (!normalizeAddress(pickup) || !normalizeAddress(dropoff)) {
      Alert.alert(
        tr("clientRestaurantMenu.missingFieldsTitle", "Champs manquants"),
        tr(
          "clientRestaurantMenu.missingFieldsCreate",
          "Merci de saisir l’adresse pickup et l’adresse de livraison."
        )
      );
      return;
    }

    if (!isAddressReady(pickup) || !isAddressReady(dropoff)) {
      Alert.alert(
        tr("clientRestaurantMenu.incompleteAddressTitle", "Adresse incomplète"),
        tr(
          "clientRestaurantMenu.incompleteAddressBody",
          "Merci de saisir une adresse plus complète avant de créer la commande."
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
        tr("clientRestaurantMenu.missingCoordsTitle", "Coords manquantes"),
        tr(
          "clientRestaurantMenu.missingCoordsBody",
          "Merci de refaire l’estimation pour récupérer les coordonnées GPS avant de créer la commande."
        )
      );
      return;
    }

    try {
      if (creating) return;
      setCreating(true);

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;

      if (!sessionData.session) {
        Alert.alert(
          tr("auth.loginRequiredTitle", "Connexion requise"),
          tr("auth.loginRequiredBody", "Merci de te connecter avant de créer une commande.")
        );
        return;
      }

      const activeRestaurantProfile = restaurantProfile;

      if (!activeRestaurantProfile) {
        throw new Error(
          tr(
            "clientRestaurantMenu.errors.restaurantUnavailable",
            "Ce restaurant n’est pas disponible ou son adresse GPS n’est pas encore configurée."
          )
        );
      }

      const pickupValue = normalizeAddress(pickup);
      const dropoffValue = normalizeAddress(dropoff);

      const { orderId, pricing } = await createFoodOrder(
        {
          restaurant_id: restaurantId,
          restaurant_name: activeRestaurantProfile.restaurant_name || restaurantName,
          pickup_address: pickupValue,
          dropoff_address: dropoffValue,
          pickup_lat: pickupCoords.lat,
          pickup_lng: pickupCoords.lng,
          dropoff_lat: dropoffCoords.lat,
          dropoff_lng: dropoffCoords.lng,
          items: cart.map((item) => ({
            item_id: item.id,
            quantity: item.quantity,
          })),
          leave_at_door: leaveAtDoor,
        },
        {
          countryCode: market.countryCode,
          lat: dropoffCoords.lat,
          lng: dropoffCoords.lng,
        }
      );

      setServerPricing(pricing);

      await startCheckoutForOrder(orderId, sessionData.session.access_token);

      navigation.reset({
        index: 0,
        routes: [{ name: "ClientOrderDetails", params: { orderId } }],
      });
    } catch (err: any) {
      console.error("Erreur création commande restaurant (mobile):", err);
      Alert.alert(
        tr("common.error.title", "Erreur"),
        err?.message ??
          tr(
            "clientRestaurantMenu.createOrderError",
            "Impossible de créer la commande pour le moment."
          )
      );
    } finally {
      setCreating(false);
    }
  }

  const canCreateOrder =
    !creating &&
    !estimating &&
    !!restaurantId &&
    !!restaurantProfile &&
    cart.length > 0 &&
    distanceMiles != null &&
    etaMinutes != null &&
    deliveryFee != null &&
    !!pickupCoords &&
    !!dropoffCoords;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={restaurantProfile?.restaurant_name || restaurantName}
        subtitle={tr(
          "clientRestaurantMenu.header.subtitle",
          "Parcours le menu et ajoute des plats à ta commande MMD."
        )}
        fallbackRoute="ClientRestaurantList"
        variant="dark"
      />

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: 24,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#F9FAFB", fontSize: 16, fontWeight: "700", marginBottom: 8 }}>
            {tr("clientRestaurantMenu.menu.title", "Menu du restaurant")}
          </Text>

          {loading ? (
            <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 16 }}>
              <ActivityIndicator size="small" color="#22C55E" />
              <Text style={{ marginTop: 8, color: "#9CA3AF", fontSize: 13 }}>
                {tr("clientRestaurantMenu.menu.loading", "Chargement du menu…")}
              </Text>
            </View>
          ) : items.length === 0 ? (
            <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
              {tr(
                "clientRestaurantMenu.menu.empty",
                "Aucun plat pour l’instant. Le restaurant n’a pas encore configuré son menu dans MMD Delivery."
              )}
            </Text>
          ) : (
            items.map((item) => {
              const price = getItemPrice(item);

              return (
                <View
                  key={item.id}
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: "#111827",
                    backgroundColor: "#020617",
                    overflow: "hidden",
                    marginBottom: 12,
                  }}
                >
                  {item.image_url ? (
                    <Image
                      source={{ uri: item.image_url }}
                      style={{ width: "100%", height: 170, backgroundColor: "#111827" }}
                      resizeMode="cover"
                      onError={(e) =>
                        console.log("⚠️ menu image error:", item.image_url, e.nativeEvent)
                      }
                    />
                  ) : null}

                  <View style={{ padding: 12 }}>
                    <Text style={{ color: "#F9FAFB", fontSize: 15, fontWeight: "800" }}>
                      {item.name}
                    </Text>

                    {!!item.category && (
                      <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 2 }}>
                        {item.category}
                      </Text>
                    )}

                    {!!item.description && (
                      <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 6 }}>
                        {item.description}
                      </Text>
                    )}

                    <View
                      style={{
                        marginTop: 10,
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: "#F9FAFB", fontSize: 14, fontWeight: "900" }}>
                        {money(price)} {currency}
                      </Text>

                      <TouchableOpacity
                        onPress={() => addToCart(item)}
                        style={{
                          backgroundColor: "#22C55E",
                          borderRadius: 999,
                          paddingVertical: 8,
                          paddingHorizontal: 20,
                        }}
                      >
                        <Text style={{ color: "white", fontSize: 13, fontWeight: "800" }}>
                          {tr("clientRestaurantMenu.menu.add", "Ajouter")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>

        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#F9FAFB", fontSize: 15, fontWeight: "700", marginBottom: 8 }}>
            {tr("clientRestaurantMenu.addresses.title", "Adresses pour la livraison")}
          </Text>

          <View style={{ marginBottom: 10 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 4 }}>
              {tr(
                "clientRestaurantMenu.addresses.pickupLabel",
                "Adresse pickup (restaurant / point de départ)"
              )}
            </Text>

            <TextInput
              value={pickup}
              onChangeText={setPickup}
              editable={!pickupLocked}
              placeholder={tr(
                "clientRestaurantMenu.addresses.pickupPlaceholder",
                "Ex : 686 Vermont St Brooklyn NY 11207"
              )}
              placeholderTextColor="#4B5563"
              style={{
                backgroundColor: pickupLocked ? "#0B1220" : "#020617",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: pickupLocked ? "#1F2937" : "#374151",
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "white",
                fontSize: 14,
                opacity: pickupLocked ? 0.95 : 1,
              }}
            />

            {pickupLocked && (
              <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 6 }}>
                {tr(
                  "clientRestaurantMenu.addresses.pickupLockedHint",
                  "Adresse du restaurant remplie automatiquement."
                )}
              </Text>
            )}
          </View>

          <View>
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 4 }}>
              {tr("clientRestaurantMenu.addresses.dropoffLabel", "Adresse de livraison (client)")}
            </Text>

            <TextInput
              value={dropoff}
              onChangeText={setDropoff}
              placeholder={tr(
                "clientRestaurantMenu.addresses.dropoffPlaceholder",
                "Ex : 1112 Flatbush Ave Brooklyn NY 11226"
              )}
              placeholderTextColor="#4B5563"
              autoCapitalize="words"
              autoCorrect={false}
              style={{
                backgroundColor: "#020617",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#374151",
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "white",
                fontSize: 14,
              }}
            />
          </View>

          <View
            style={{
              marginTop: 12,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#1F2937",
              backgroundColor: "#07111F",
              paddingHorizontal: 12,
              paddingVertical: 10,
            }}
          >
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ color: "white", fontSize: 14, fontWeight: "700" }}>
                {tr("clientRestaurantMenu.leaveAtDoor.title", "Laisser devant la porte")}
              </Text>
              <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 4, lineHeight: 18 }}>
                {tr(
                  "clientRestaurantMenu.leaveAtDoor.hint",
                  "Autorise le livreur à déposer la commande devant la porte après l’attente maximale (photo obligatoire)."
                )}
              </Text>
            </View>
            <Switch
              value={leaveAtDoor}
              onValueChange={setLeaveAtDoor}
              trackColor={{ false: "#374151", true: "#166534" }}
              thumbColor={leaveAtDoor ? "#22C55E" : "#9CA3AF"}
            />
          </View>

          <View
            style={{
              marginTop: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#1F2937",
              backgroundColor: "#07111F",
              padding: 12,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {estimating ? (
                <>
                  <ActivityIndicator size="small" color="#22C55E" />
                  <Text
                    style={{
                      color: "#D1FAE5",
                      fontSize: 12,
                      fontWeight: "700",
                      marginLeft: 8,
                    }}
                  >
                    {tr(
                      "clientRestaurantMenu.addresses.estimating",
                      "Calcul automatique de la livraison..."
                    )}
                  </Text>
                </>
              ) : estimateError ? (
                <Text style={{ color: "#FCA5A5", fontSize: 12, fontWeight: "700" }}>
                  {estimateError}
                </Text>
              ) : distanceMiles != null && etaMinutes != null && deliveryFee != null ? (
                <Text style={{ color: "#86EFAC", fontSize: 12, fontWeight: "700" }}>
                  {tr(
                    "clientRestaurantMenu.addresses.estimateReady",
                    "Estimation de livraison prête."
                  )}
                </Text>
              ) : (
                <Text style={{ color: "#94A3B8", fontSize: 12 }}>
                  {tr(
                    "clientRestaurantMenu.addresses.autoEstimateHint",
                    "L’estimation se lance automatiquement quand l’adresse est complète."
                  )}
                </Text>
              )}
            </View>

            {(distanceMiles != null || etaMinutes != null || deliveryFee != null) && (
              <View style={{ marginTop: 10 }}>
                <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                  {tr("clientRestaurantMenu.summary.distance", "Distance")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {distanceMiles != null ? `${distanceMiles.toFixed(2)} mi` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 4 }}>
                  {tr("clientRestaurantMenu.summary.eta", "Temps estimé")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "700" }}>
                    {etaMinutes != null ? `${Math.round(etaMinutes)} min` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#9CA3AF", fontSize: 12, marginTop: 4 }}>
                  {tr("clientRestaurantMenu.summary.fee", "Frais de livraison")} :{" "}
                  <Text style={{ color: "#E5E7EB", fontWeight: "900" }}>
                    {displayDeliveryFee != null ? `${money(displayDeliveryFee)} ${currency}` : "—"}
                  </Text>
                </Text>

                <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 6 }}>
                  {tr("clientRestaurantMenu.summary.pickupGps", "Pickup GPS")} :{" "}
                  {pickupCoords ? `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lng.toFixed(5)}` : "—"}
                </Text>

                <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 2 }}>
                  {tr("clientRestaurantMenu.summary.dropoffGps", "Dropoff GPS")} :{" "}
                  {dropoffCoords
                    ? `${dropoffCoords.lat.toFixed(5)}, ${dropoffCoords.lng.toFixed(5)}`
                    : "—"}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View
          style={{
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: "#F9FAFB", fontSize: 15, fontWeight: "800", marginBottom: 10 }}>
            {tr("clientRestaurantMenu.cart.title", "Panier")}
          </Text>

          {cart.length === 0 ? (
            <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
              {tr(
                "clientRestaurantMenu.cart.empty",
                "Ton panier est vide. Ajoute des plats depuis le menu."
              )}
            </Text>
          ) : (
            <>
              {cart.map((item) => (
                <View
                  key={item.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 10,
                    borderBottomWidth: 1,
                    borderBottomColor: "#111827",
                  }}
                >
                  <View
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: 14,
                      overflow: "hidden",
                      backgroundColor: "#111827",
                      marginRight: 10,
                    }}
                  >
                    {item.image_url ? (
                      <Image
                        source={{ uri: item.image_url }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                        onError={(e) =>
                          console.log("⚠️ cart image error:", item.image_url, e.nativeEvent)
                        }
                      />
                    ) : null}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={{ color: "#F9FAFB", fontSize: 14, fontWeight: "800" }}>
                      {item.name}
                    </Text>

                    {!!item.category && (
                      <Text style={{ color: "#9CA3AF", fontSize: 11, marginTop: 2 }}>
                        {item.category}
                      </Text>
                    )}

                    <Text style={{ color: "#6B7280", fontSize: 11, marginTop: 4 }}>
                      {money(item.unit_price)} {currency}{" "}
                      {tr("clientRestaurantMenu.cart.perUnit", "/ unité")}
                    </Text>
                  </View>

                  <View style={{ flexDirection: "row", alignItems: "center", marginLeft: 10 }}>
                    <TouchableOpacity
                      onPress={() => updateQuantity(item.id, item.quantity - 1)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "#334155",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: "#E5E7EB", fontSize: 16, fontWeight: "900" }}>-</Text>
                    </TouchableOpacity>

                    <Text
                      style={{
                        color: "#E5E7EB",
                        fontSize: 13,
                        fontWeight: "900",
                        minWidth: 22,
                        textAlign: "center",
                        marginHorizontal: 10,
                      }}
                    >
                      {item.quantity}
                    </Text>

                    <TouchableOpacity
                      onPress={() => updateQuantity(item.id, item.quantity + 1)}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "#334155",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Text style={{ color: "#E5E7EB", fontSize: 16, fontWeight: "900" }}>+</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={{ marginLeft: 12, alignItems: "flex-end" }}>
                    <Text style={{ color: "#F9FAFB", fontSize: 13, fontWeight: "900" }}>
                      {money(item.unit_price * item.quantity)} {currency}
                    </Text>

                    <TouchableOpacity onPress={() => removeFromCart(item.id)} style={{ marginTop: 4 }}>
                      <Text style={{ color: "#F97373", fontSize: 11, fontWeight: "700" }}>
                        {tr("common.delete", "Supprimer")}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                    {tr("clientRestaurantMenu.totals.subtotal", "Sous-total")}
                  </Text>
                  <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "800" }}>
                    {money(displaySubtotal)} {currency}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                    {tr("clientRestaurantMenu.totals.taxLabel", "Taxes")} ({displayTaxRatePct.toFixed(2)}%)
                  </Text>
                  <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "800" }}>
                    {money(displayTax)} {currency}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                    {tr("clientRestaurantMenu.totals.totalNoDelivery", "Total (hors livraison)")}
                  </Text>
                  <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "900" }}>
                    {money(roundMoney(displaySubtotal + displayTax))} {currency}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                    {tr("clientRestaurantMenu.summary.fee", "Frais de livraison")}
                  </Text>
                  <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "800" }}>
                    {displayDeliveryFee != null ? `${money(displayDeliveryFee)} ${currency}` : "—"}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                  <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
                    {tr("clientRestaurantMenu.totals.serviceFee", "Frais de service")}
                  </Text>
                  <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "800" }}>
                    {money(displayServiceFee)} {currency}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "800" }}>
                    {tr("clientRestaurantMenu.totals.finalTotal", "Total final")}
                  </Text>
                  <Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "900" }}>
                    {money(displayGrandTotal)} {currency}
                  </Text>
                </View>
              </View>
            </>
          )}
        </View>

        <TouchableOpacity
          onPress={handleCreateOrder}
          disabled={!canCreateOrder}
          style={{
            backgroundColor: canCreateOrder ? "#3B82F6" : "#4B5563",
            borderRadius: 999,
            paddingVertical: 12,
            alignItems: "center",
            flexDirection: "row",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          {creating && <ActivityIndicator color="#ffffff" />}
          <Text
            style={{
              color: "white",
              fontSize: 14,
              fontWeight: "900",
              marginLeft: creating ? 8 : 0,
            }}
          >
            {creating
              ? tr("clientRestaurantMenu.create.creating", "Création de la commande…")
              : tr("clientRestaurantMenu.create.confirm", "Confirmer et créer la commande MMD")}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}




export default ClientRestaurantMenuScreen;
