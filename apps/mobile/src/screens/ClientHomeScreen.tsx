import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View, StatusBar, Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { applyLiveTripFilters } from "../lib/tripVisibility";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";
import { clearSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";
import { setLocaleForRoleAndApply } from "../i18n";
import type { AppLanguageCode } from "../i18n/languageOptions";
import i18n from "../i18n";
import { formatMoney as formatMoneyLocale } from "../i18n/formatters";
import { resolveMarketScopeFromFeatures } from "../lib/marketScope";
import { useClientPlatformFeatures } from "../hooks/useClientPlatformFeatures";
import { ClientHomeV4View, resolveClientAdAction } from "../components/client/home/ClientHomeV4View";
import { v4Styles } from "../components/client/home/clientHomeTheme";
import { registerUserPushToken } from "../lib/notifications";
import {
  computeClientOrderStats,
  isClientActiveStatus,
  isClientCancelledStatus,
  isClientCompletedStatus,
  isVisibleClientTrip,
  selectClientHomeDisplayItems,
} from "../lib/clientOrderDisplay";
import { fetchLoyaltySummary, type LoyaltySummary } from "../lib/loyaltyApi";
import {
  fetchClientAdvertisements,
  trackAdvertisementEvent,
  type ClientAdvertisement,
} from "../lib/clientAdvertisementsApi";
import * as Location from "expo-location";
import { reverseGeocode } from "../lib/reverseGeocode";
import { getMapboxToken } from "../lib/mapboxConfig";

type Nav = NativeStackNavigationProp<RootStackParamList, "ClientHome">;

function looksLikeCoords(value: string) {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value.trim());
}

function pickAreaLabelFromDevice(
  place: Location.LocationGeocodedAddress | null | undefined,
): string | null {
  if (!place) return null;
  const candidates = [place.district, place.city, place.subregion, place.name];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (!s || looksLikeCoords(s)) continue;
    if (/^\d+\s/.test(s) && /\b(st|street|ave|avenue|rd|road|blvd|drive|dr|ln|lane)\b/i.test(s)) {
      continue;
    }
    return s;
  }
  return null;
}

function pickAreaLabelFromGeocode(fullAddress: string, shortName: string): string | null {
  const short = String(shortName || "").trim();
  if (
    short &&
    !looksLikeCoords(short) &&
    !/^\d+\s/.test(short) &&
    !/\b(st|street|ave|avenue|rd|road|blvd|drive|dr|ln|lane)\b/i.test(short)
  ) {
    return short;
  }
  const parts = String(fullAddress || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (looksLikeCoords(part) || part.length <= 2) continue;
    if (/^\d+\s/.test(part)) continue;
    if (/\b(united states|usa|france|guinea|guinée|canada)\b/i.test(part)) continue;
    return part;
  }
  return null;
}

async function reverseGeocodeAreaViaMapbox(
  lat: number,
  lng: number,
): Promise<string | null> {
  const token = getMapboxToken().trim();
  if (!token) return null;
  try {
    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json` +
      `?access_token=${encodeURIComponent(token)}` +
      `&types=neighborhood,locality,place,district` +
      `&limit=5`;
    const res = await fetch(url);
    const json = (await res.json().catch(() => null)) as {
      features?: Array<{
        text?: string;
        place_type?: string[];
        place_name?: string;
      }>;
    } | null;
    if (!res.ok || !Array.isArray(json?.features)) return null;

    const preferred = ["neighborhood", "locality", "place", "district"];
    for (const type of preferred) {
      const hit = json.features.find((f) => f.place_type?.includes(type));
      const name = String(hit?.text || "").trim();
      if (name && !looksLikeCoords(name)) return name;
    }
    const fallback = String(json.features[0]?.text || "").trim();
    return fallback && !looksLikeCoords(fallback) ? fallback : null;
  } catch {
    return null;
  }
}

async function reverseGeocodeAreaViaNominatim(
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(String(lat))}` +
      `&lon=${encodeURIComponent(String(lng))}` +
      `&zoom=14&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "MMD-Delivery-Mobile/1.0",
      },
    });
    const json = (await res.json().catch(() => null)) as {
      address?: Record<string, string>;
      name?: string;
    } | null;
    if (!res.ok || !json?.address) return null;
    const a = json.address;
    const candidates = [
      a.neighbourhood,
      a.suburb,
      a.quarter,
      a.city_district,
      a.village,
      a.town,
      a.city,
      a.municipality,
      a.county,
      a.state_district,
      json.name,
    ];
    for (const c of candidates) {
      const s = String(c || "").trim();
      if (s && !looksLikeCoords(s)) return s;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveClientAreaLabel(): Promise<string | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) {
      const requested = await Location.requestForegroundPermissionsAsync();
      if (!requested.granted) {
        return null;
      }
    }

    let coords = (await Location.getLastKnownPositionAsync())?.coords;
    if (!coords) {
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        coords = current?.coords;
      } catch {
        // GPS may be unavailable (emulator / disabled services)
      }
    }
    if (!coords) {
      return null;
    }

    const lat = coords.latitude;
    const lng = coords.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const fromMapbox = await reverseGeocodeAreaViaMapbox(lat, lng);
    if (fromMapbox) return fromMapbox;

    const fromOsm = await reverseGeocodeAreaViaNominatim(lat, lng);
    if (fromOsm) return fromOsm;

    try {
      const places = await Location.reverseGeocodeAsync({
        latitude: lat,
        longitude: lng,
      });
      const fromDevice = pickAreaLabelFromDevice(places[0]);
      if (fromDevice) return fromDevice;
    } catch {
      // fall through
    }

    const geo = await reverseGeocode(lat, lng);
    return pickAreaLabelFromGeocode(geo.fullAddress, geo.shortName);
  } catch {
    return null;
  }
}

type OrderStatus = string;

type ItemKind = "restaurant_order" | "delivery_request" | "taxi_ride";

type ClientItem = {
  id: string;
  kind: ItemKind;
  status: OrderStatus;
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
  is_test?: boolean | null;
  hidden_from_user?: boolean | null;
  archived_at?: string | null;
};

type OrderRowDb = {
  id?: unknown;
  kind?: unknown;
  status?: unknown;
  payment_status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  paid_at?: unknown;
  pickup_address?: unknown;
  dropoff_address?: unknown;
  distance_miles?: unknown;
  total?: unknown;
  delivery_fee?: unknown;
  stripe_session_id?: unknown;
  stripe_payment_intent_id?: unknown;
  client_user_id?: unknown;
  created_by?: unknown;
  is_test?: unknown;
  hidden_from_user?: unknown;
  archived_at?: unknown;
};

type DeliveryRequestRowDb = {
  id?: unknown;
  status?: unknown;
  payment_status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  paid_at?: unknown;
  pickup_address?: unknown;
  dropoff_address?: unknown;
  distance_miles?: unknown;
  total?: unknown;
  delivery_fee?: unknown;
  stripe_session_id?: unknown;
  stripe_payment_intent_id?: unknown;
  client_user_id?: unknown;
  created_by?: unknown;
  is_test?: unknown;
  hidden_from_user?: unknown;
  archived_at?: unknown;
};

type TaxiRideRowDb = {
  id?: unknown;
  status?: unknown;
  payment_status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  pickup_address?: unknown;
  dropoff_address?: unknown;
  distance_miles?: unknown;
  total_cents?: unknown;
  is_test?: unknown;
  hidden_from_user?: unknown;
  archived_at?: unknown;
};

type ErrorState =
  | null
  | {
      key: string;
      fallback: string;
      params?: Record<string, unknown>;
    };

const FETCH_LIMIT = 50;
const DEFAULT_CLIENT_NAME = "Client";

function isInProgress(status: OrderStatus) {
  return isClientActiveStatus(status);
}

function isDelivered(status: OrderStatus) {
  return isClientCompletedStatus(status);
}

function isCanceled(status: OrderStatus) {
  return isClientCancelledStatus(status);
}

function orderStatusLabelForCard(
  item: ClientItem,
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string
) {
  if (item.kind === "delivery_request") {
    if (item.payment_status === "paid" && item.status === "pending") {
      return `💳 ${ts(
        "delivery_requests.status.paid_pending",
        "Paid • Waiting for a driver"
      )}`;
    }
    if (item.payment_status === "processing" && item.status === "pending") {
      return `⏳ ${ts(
        "delivery_requests.status.processing_pending",
        "Payment processing"
      )}`;
    }
    if (item.payment_status === "unpaid") {
      return `💤 ${ts("delivery_requests.status.unpaid", "Unpaid")}`;
    }
    if (item.status === "dispatched") {
      return `🚙 ${ts("orders.status.dispatched", "On the way")}`;
    }
    if (item.status === "delivered") {
      return `✅ ${ts("orders.status.delivered", "Delivered")}`;
    }
    if (item.status === "canceled") {
      return `⛔ ${ts("orders.status.canceled", "Canceled")}`;
    }
    return `⏳ ${ts("orders.status.pending", "Pending")}`;
  }

  if (item.status === "dispatched") {
    return `🚙 ${ts("orders.status.dispatched", "On the way")}`;
  }
  if (item.status === "delivered") {
    return `✅ ${ts("orders.status.delivered", "Delivered")}`;
  }
  if (item.status === "canceled") {
    return `⛔ ${ts("orders.status.canceled", "Canceled")}`;
  }
  if (item.status === "accepted") {
    return `👨‍🍳 ${ts("orders.status.accepted", "Accepted")}`;
  }
  if (item.status === "prepared") {
    return `🍽️ ${ts("orders.status.prepared", "Preparing")}`;
  }
  if (item.status === "ready") {
    return `📦 ${ts("orders.status.ready", "Ready")}`;
  }
  return `⏳ ${ts("orders.status.pending", "Pending")}`;
}

function progressWidth(points: number, target: number): `${number}%` {
  if (target <= 0) return "0%";
  const percent = Math.max(0, Math.min(100, (points / target) * 100));
  return `${percent}%`;
}

function getFirstName(name: string) {
  const clean = (name || "").trim();
  if (!clean) return DEFAULT_CLIENT_NAME;
  return clean.split(" ")[0] || DEFAULT_CLIENT_NAME;
}

function getGreeting(ts: (key: string, fallback: string) => string) {
  const hour = new Date().getHours();
  if (hour < 12) return ts("client.home.greeting_morning", "Good morning");
  if (hour < 18) return ts("client.home.greeting_afternoon", "Good afternoon");
  return ts("client.home.greeting_evening", "Good evening");
}

function formatCurrency(
  amount: number | null | undefined,
  currencyCode: string
) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return formatMoneyLocale(amount, currencyCode, i18n.language);
}

function formatCompactDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return `${d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} • ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function recentOrderTitle(item: ClientItem) {
  if (item.kind === "taxi_ride") return "Taxi ride";
  if (item.kind === "delivery_request") return "Send Package";
  const pickup = item.pickup_address?.split(",")[0]?.trim();
  return pickup || "Restaurant Order";
}

function premiumStatusText(
  item: ClientItem,
  ts: (key: string, fallback: string, params?: Record<string, unknown>) => string
) {
  if (item.status === "delivered") return ts("orders.status.delivered", "Delivered");
  if (item.status === "canceled") return ts("orders.status.canceled", "Canceled");
  if (item.status === "dispatched") return ts("orders.status.dispatched", "On the way");
  if (item.kind === "delivery_request" && item.status === "pending") {
    return ts("delivery_requests.status.paid_pending", "Finding driver");
  }
  return orderStatusLabelForCard(item, ts).replace(/^\S+\s/, "");
}

function isValidOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && value.trim().length > 0;
}

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

function normalizeOrderRows(rows: OrderRowDb[] | null | undefined): ClientItem[] {
  if (!Array.isArray(rows)) return [];

  const result: ClientItem[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    if (!isValidOrderStatus(row.status)) continue;

    const rawKind = typeof row.kind === "string" ? row.kind.trim().toLowerCase() : "";

    // ✅ IMPORTANT:
    // On ne montre plus pickup_dropoff dans la home client.
    // Le flux client officiel "delivery request" doit rester uniquement celui avec la voiture.
    // Le flux carton sera gardé pour un autre usage plus tard (taxi / autre module).
    if (rawKind === "pickup_dropoff") {
      continue;
    }

    result.push({
      id: row.id,
      kind: "restaurant_order",
      status: row.status,
      payment_status: toSafeString(row.payment_status),
      created_at: toSafeString(row.created_at),
      updated_at: toSafeString(row.updated_at),
      paid_at: toSafeString(row.paid_at),
      pickup_address: toSafeString(row.pickup_address),
      dropoff_address: toSafeString(row.dropoff_address),
      distance_miles: toSafeNumber(row.distance_miles),
      total: toSafeNumber(row.total),
      delivery_fee: toSafeNumber(row.delivery_fee),
      stripe_session_id: toSafeString(row.stripe_session_id),
      stripe_payment_intent_id: toSafeString(row.stripe_payment_intent_id),
      is_test: row.is_test === true,
      hidden_from_user: row.hidden_from_user === true,
      archived_at: toSafeString(row.archived_at),
    });
  }

  return result;
}

function normalizeDeliveryRequestRows(
  rows: DeliveryRequestRowDb[] | null | undefined
): ClientItem[] {
  if (!Array.isArray(rows)) return [];

  const result: ClientItem[] = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    if (!isValidOrderStatus(row.status)) continue;

    result.push({
      id: row.id,
      kind: "delivery_request",
      status: row.status,
      payment_status: toSafeString(row.payment_status),
      created_at: toSafeString(row.created_at),
      updated_at: toSafeString(row.updated_at),
      paid_at: toSafeString(row.paid_at),
      pickup_address: toSafeString(row.pickup_address),
      dropoff_address: toSafeString(row.dropoff_address),
      distance_miles: toSafeNumber(row.distance_miles),
      total: toSafeNumber(row.total),
      delivery_fee: toSafeNumber(row.delivery_fee),
      stripe_session_id: toSafeString(row.stripe_session_id),
      stripe_payment_intent_id: toSafeString(row.stripe_payment_intent_id),
      is_test: row.is_test === true,
      hidden_from_user: row.hidden_from_user === true,
      archived_at: toSafeString(row.archived_at),
    });
  }

  return result;
}

function normalizeTaxiRideRows(
  rows: TaxiRideRowDb[] | null | undefined
): ClientItem[] {
  if (!Array.isArray(rows)) return [];
  const result: ClientItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.id !== "string" || !row.id.trim()) continue;
    if (!isValidOrderStatus(row.status)) continue;
    const cents = toSafeNumber(row.total_cents);
    result.push({
      id: row.id,
      kind: "taxi_ride",
      status: String(row.status),
      payment_status: toSafeString(row.payment_status),
      created_at: toSafeString(row.created_at),
      updated_at: toSafeString(row.updated_at),
      paid_at: null,
      pickup_address: toSafeString(row.pickup_address),
      dropoff_address: toSafeString(row.dropoff_address),
      distance_miles: toSafeNumber(row.distance_miles),
      total: cents != null ? cents / 100 : null,
      delivery_fee: null,
      stripe_session_id: null,
      stripe_payment_intent_id: null,
      is_test: row.is_test === true,
      hidden_from_user: row.hidden_from_user === true,
      archived_at: toSafeString(row.archived_at),
    });
  }
  return result;
}

function sortClientItems(items: ClientItem[]) {
  return [...items].sort((a, b) => {
    const aRaw = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bRaw = b.created_at ? new Date(b.created_at).getTime() : 0;

    const aTime = Number.isFinite(aRaw) ? aRaw : 0;
    const bTime = Number.isFinite(bRaw) ? bRaw : 0;

    return bTime - aTime;
  });
}

function dedupeClientItems(items: ClientItem[]) {
  const map = new Map<string, ClientItem>();

  for (const item of items) {
    const key = item.id;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      continue;
    }

    // On préfère delivery_request si jamais il y a conflit d'id
    if (existing.kind !== "delivery_request" && item.kind === "delivery_request") {
      map.set(key, item);
      continue;
    }

    const existingTime = existing.updated_at
      ? new Date(existing.updated_at).getTime()
      : existing.created_at
      ? new Date(existing.created_at).getTime()
      : 0;

    const incomingTime = item.updated_at
      ? new Date(item.updated_at).getTime()
      : item.created_at
      ? new Date(item.created_at).getTime()
      : 0;

    if (incomingTime > existingTime) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

function isValidImageUri(uri: string | null) {
  if (!uri) return false;
  return /^https?:\/\//i.test(uri);
}

function resolveClientAvatarUrl(
  value: string | null | undefined,
  cacheKey?: string | null,
): string | null {
  const clean = String(value || "").trim();
  if (!clean) return null;
  const bust = cacheKey ? String(cacheKey).replace(/[^\w.-]/g, "").slice(0, 32) : "";
  const withBust = (url: string) => {
    if (!bust) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${bust}`;
  };
  if (isValidImageUri(clean)) return withBust(clean);
  const { data } = supabase.storage.from("avatars").getPublicUrl(clean);
  const url = data?.publicUrl || null;
  return isValidImageUri(url) ? withBust(url) : null;
}

export function ClientHomeScreen() {
  const navigation = useNavigation<Nav>();
  const { t, i18n } = useTranslation();
  void i18n.language;

  const isMountedRef = useRef(true);
  const fetchInFlightRef = useRef(false);
  const signOutInFlightRef = useRef(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null
  );

  const ts = useCallback(
    (key: string, fallback: string, params?: Record<string, unknown>) =>
      String(t(key, fallback as never, params as never)),
    [t]
  );

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<ClientItem[]>([]);
  const [error, setError] = useState<ErrorState>(null);
  const [recentActivityUnavailable, setRecentActivityUnavailable] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string>("");
  const [clientUserId, setClientUserId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loyaltySummary, setLoyaltySummary] = useState<LoyaltySummary | null>(
    null,
  );
  const [advertisements, setAdvertisements] = useState<ClientAdvertisement[]>([]);
  const [areaLabel, setAreaLabel] = useState<string | null>(null);
  const [profileAreaLabel, setProfileAreaLabel] = useState<string | null>(null);
  const { features: platformFeatures, refresh: refreshPlatformFeatures, refreshWithCurrentLocation } =
    useClientPlatformFeatures();

  const market = useMemo(
    () => resolveMarketScopeFromFeatures(platformFeatures),
    [platformFeatures]
  );

  const scopeLabel = market.scopeResolved
    ? market.displayLabel
    : platformFeatures.scope_label ??
      platformFeatures.scope?.scope_label ??
      null;

  const scopeSource = platformFeatures.scope_source ?? platformFeatures.scope?.scope_source ?? null;

  const scopeSourceLabel = useMemo(() => {
    switch (scopeSource) {
      case "gps":
        return ts("client.home.scope.source.gps", "GPS");
      case "order_pickup":
        return ts("client.home.scope.source.order", "Order address");
      case "saved_address":
        return ts("client.home.scope.source.savedAddress", "Saved address");
      case "profile":
        return ts("client.home.scope.source.profile", "Profile");
      case "manual":
        return ts("client.home.scope.source.manual", "Manual selection");
      case "country_fallback":
        return ts("client.home.scope.source.fallback", "Default");
      default:
        return scopeSource ?? ts("client.home.scope.source.unknown", "Unknown");
    }
  }, [scopeSource, ts]);

  const showUseCurrentLocation =
    scopeSource === "saved_address" ||
    scopeSource === "profile" ||
    scopeSource === "country_fallback" ||
    scopeSource === "manual";

  const comingSoonLabel = ts("client.home.v4.comingSoon", "Launching soon");
  const marketplaceSoonLabel = ts(
    "client.home.v4.service.marketplace.soon",
    "Discover local stores"
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (realtimeChannelRef.current) {
        void unsubscribeSupabaseChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!i18n.language || i18n.language === "dev") {
      void setLocaleForRoleAndApply("client", "en");
    }
  }, [i18n.language]);

  const refreshAreaLabel = useCallback(async () => {
    const label = await resolveClientAreaLabel();
    if (!isMountedRef.current) return;
    setAreaLabel(label);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setMenuOpen(false);
      void refreshPlatformFeatures();
      void refreshAreaLabel();
      const retry = setTimeout(() => {
        void refreshAreaLabel();
      }, 2800);
      void registerUserPushToken("client");
      return () => {
        clearTimeout(retry);
        setMenuOpen(false);
      };
    }, [refreshPlatformFeatures, refreshAreaLabel])
  );

  const fetchAllForUser = useCallback(async (userId: string) => {
    const orderSelect = `
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
            client_user_id,
            is_test,
            hidden_from_user,
            archived_at
          `;
    const drSelect = `
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
            client_user_id,
            created_by,
            is_test,
            hidden_from_user,
            archived_at
          `;

    const [ordersRes, requestsClientRes, requestsCreatedRes, taxiRes] =
      await Promise.all([
      applyLiveTripFilters(supabase.from("orders").select(orderSelect))
        .or(
          `client_user_id.eq.${userId},client_id.eq.${userId},created_by.eq.${userId},user_id.eq.${userId}`
        )
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),

      applyLiveTripFilters(supabase.from("delivery_requests").select(drSelect))
        .eq("client_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),

      applyLiveTripFilters(supabase.from("delivery_requests").select(drSelect))
        .eq("created_by", userId)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),

      applyLiveTripFilters(
        supabase.from("taxi_rides").select(
          `
            id,
            status,
            payment_status,
            created_at,
            updated_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total_cents,
            is_test,
            hidden_from_user,
            archived_at
          `,
        ),
      )
        .eq("client_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(FETCH_LIMIT),
    ]);

    // If archive columns are not migrated yet, retry without them.
    const archiveMissing =
      /archived_at|is_test|hidden_from_user/i.test(
        String(ordersRes.error?.message ?? ""),
      ) ||
      /archived_at|is_test|hidden_from_user/i.test(
        String(requestsClientRes.error?.message ?? ""),
      ) ||
      /archived_at|is_test|hidden_from_user/i.test(
        String(taxiRes.error?.message ?? ""),
      );

    let ordersData = ordersRes.data;
    let ordersError = ordersRes.error;
    let drClientData = requestsClientRes.data;
    let drCreatedData = requestsCreatedRes.data;
    let drError =
      requestsClientRes.error || requestsCreatedRes.error;
    let taxiData = taxiRes.data;
    let taxiError = taxiRes.error;

    if (archiveMissing) {
      const retry = await Promise.all([
        supabase
          .from("orders")
          .select(
            `id,kind,status,payment_status,created_at,updated_at,paid_at,pickup_address,dropoff_address,distance_miles,total,delivery_fee,stripe_session_id,stripe_payment_intent_id,client_user_id`,
          )
          .or(
            `client_user_id.eq.${userId},client_id.eq.${userId},created_by.eq.${userId},user_id.eq.${userId}`,
          )
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT),
        supabase
          .from("delivery_requests")
          .select(
            `id,status,payment_status,created_at,updated_at,paid_at,pickup_address,dropoff_address,distance_miles,total,delivery_fee,stripe_session_id,stripe_payment_intent_id,client_user_id,created_by`,
          )
          .eq("client_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT),
        supabase
          .from("delivery_requests")
          .select(
            `id,status,payment_status,created_at,updated_at,paid_at,pickup_address,dropoff_address,distance_miles,total,delivery_fee,stripe_session_id,stripe_payment_intent_id,client_user_id,created_by`,
          )
          .eq("created_by", userId)
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT),
        supabase
          .from("taxi_rides")
          .select(
            `id,status,payment_status,created_at,updated_at,pickup_address,dropoff_address,distance_miles,total_cents`,
          )
          .eq("client_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(FETCH_LIMIT),
      ]);
      ordersData = retry[0].data as typeof ordersData;
      ordersError = retry[0].error;
      drClientData = retry[1].data as typeof drClientData;
      drCreatedData = retry[2].data as typeof drCreatedData;
      drError = retry[1].error || retry[2].error;
      taxiData = retry[3].data as typeof taxiData;
      taxiError = retry[3].error;
    }

    if (ordersError) {
      console.log("❌ orders error:", ordersError);
    }

    if (drError) {
      console.log("❌ delivery_requests error:", drError);
    }

    if (taxiError) {
      console.log("❌ taxi_rides error:", taxiError);
    }

    const normalizedOrders = normalizeOrderRows(
      ordersError ? [] : ((ordersData as OrderRowDb[] | null) ?? [])
    );

    const normalizedRequests = normalizeDeliveryRequestRows([
      ...((drClientData as DeliveryRequestRowDb[] | null) ?? []),
      ...((drCreatedData as DeliveryRequestRowDb[] | null) ?? []),
    ]);

    const normalizedTaxi = normalizeTaxiRideRows(
      taxiError ? [] : ((taxiData as TaxiRideRowDb[] | null) ?? []),
    );

    const merged = dedupeClientItems([
      ...normalizedOrders,
      ...normalizedRequests,
      ...normalizedTaxi,
    ]).filter(isVisibleClientTrip);

    const hadFetchIssue = !!(ordersError || drError || taxiError);

    return { items: sortClientItems(merged), hadFetchIssue };
  }, []);

  const fetchOrders = useCallback(
    async (mode: "load" | "refresh" = "load", silent = false) => {
      if (fetchInFlightRef.current) return;

      fetchInFlightRef.current = true;

      if (!silent) {
        if (mode === "refresh") {
          if (isMountedRef.current) setRefreshing(true);
        } else {
          if (isMountedRef.current) setLoading(true);
        }
      }

      try {
        if (isMountedRef.current) {
          setError(null);
          setRecentActivityUnavailable(false);
        }

        const { data: sessionData, error: sessionError } =
          await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const session = sessionData?.session;
        if (!session) {
          if (!isMountedRef.current) return;

          setError({
            key: "client.home.errors.must_login",
            fallback: "You must be logged in to see your orders.",
          });
          setItems([]);
          setAvatarUrl(null);
          setDisplayName("");
          return;
        }

        const user = session.user;
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;

        const fullName =
          (typeof meta.full_name === "string" && meta.full_name) ||
          (typeof meta.name === "string" && meta.name) ||
          (typeof meta.display_name === "string" && meta.display_name) ||
          user.email ||
          DEFAULT_CLIENT_NAME;

        const metaAvatar =
          (typeof meta.avatar_url === "string" && meta.avatar_url) ||
          (typeof meta.picture === "string" && meta.picture) ||
          (typeof meta.photoURL === "string" && meta.photoURL) ||
          (typeof meta.photo_url === "string" && meta.photo_url) ||
          null;

        const [
          { items: mergedItems, hadFetchIssue },
          loyalty,
          ads,
          clientProfileRes,
          baseProfileRes,
        ] = await Promise.all([
          fetchAllForUser(user.id),
          fetchLoyaltySummary("client").catch(() => null),
          fetchClientAdvertisements({
            placement: "client_home",
            country: market.countryCode || null,
            city: null,
            language: (i18n.language || "en").split("-")[0],
            limit: 12,
          }),
          supabase
            .from("client_profiles")
            .select("avatar_url, full_name, updated_at, city, state, address")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("profiles")
            .select("avatar_url, full_name, updated_at")
            .eq("id", user.id)
            .maybeSingle(),
        ]);

        if (!isMountedRef.current) return;

        const clientRow = clientProfileRes.data as {
          avatar_url?: string | null;
          full_name?: string | null;
          updated_at?: string | null;
          city?: string | null;
          state?: string | null;
          address?: string | null;
        } | null;
        const baseRow = baseProfileRes.data as {
          avatar_url?: string | null;
          full_name?: string | null;
          updated_at?: string | null;
        } | null;

        const profileAvatar = clientRow?.avatar_url ?? baseRow?.avatar_url ?? metaAvatar;
        const profileName = clientRow?.full_name || baseRow?.full_name || fullName;
        const avatarCacheKey = clientRow?.updated_at || baseRow?.updated_at || null;
        const profileCity = String(clientRow?.city || "").trim();
        if (profileCity) {
          setProfileAreaLabel(profileCity);
        }

        setDisplayName(String(profileName));
        setAvatarUrl(resolveClientAvatarUrl(profileAvatar, avatarCacheKey));
        setItems(mergedItems);
        setLoyaltySummary(loyalty);
        setAdvertisements(ads);
        setRecentActivityUnavailable(hadFetchIssue && mergedItems.length === 0);
        setClientUserId(user.id);
      } catch (e: unknown) {
        if (!isMountedRef.current) return;

        console.log("client home fetch error:", e);
        setRecentActivityUnavailable(true);
        setError({
          key: "client.home.errors.loadFailed",
          fallback:
            e instanceof Error
              ? e.message
              : ts("client.home.errors.loadFailed", "Unable to load your recent activity."),
        });
      } finally {
        fetchInFlightRef.current = false;

        if (!isMountedRef.current || silent) return;

        if (mode === "refresh") {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [fetchAllForUser, i18n.language, market.countryCode, ts]
  );

  useEffect(() => {
    if (!clientUserId) return;

    const channel = subscribePostgresChannel(`client-home-${clientUserId}`, [
      {
        event: "*",
        table: "orders",
        filter: `client_user_id=eq.${clientUserId}`,
        callback: () => {
          void fetchOrders("load", true);
        },
      },
      {
        event: "*",
        table: "delivery_requests",
        filter: `client_user_id=eq.${clientUserId}`,
        callback: () => {
          void fetchOrders("load", true);
        },
      },
      {
        event: "*",
        table: "delivery_requests",
        filter: `created_by=eq.${clientUserId}`,
        callback: () => {
          void fetchOrders("load", true);
        },
      },
    ]);

    realtimeChannelRef.current = channel;

    return () => {
      void unsubscribeSupabaseChannel(channel);
      if (realtimeChannelRef.current === channel) {
        realtimeChannelRef.current = null;
      }
    };
  }, [clientUserId, fetchOrders]);

  useFocusEffect(
    useCallback(() => {
      void fetchOrders("load");
    }, [fetchOrders])
  );

  const stats = useMemo(() => {
    const orderStats = computeClientOrderStats(items);
    const totalOrders = orderStats.totalOrders;
    const inProgress = orderStats.active;
    const delivered = orderStats.completed;
    const canceled = orderStats.cancelled;
    const now = Date.now();

    const last24h = items.filter((o) => {
      if (!o.created_at) return false;
      const time = new Date(o.created_at).getTime();
      return !Number.isNaN(time) && now - time <= 24 * 60 * 60 * 1000;
    }).length;

    const points = loyaltySummary?.points_balance ?? 0;
    const level = loyaltySummary?.tier_label || "Bronze";
    const lifetime = loyaltySummary?.lifetime_points ?? 0;
    const nextLevelTarget =
      loyaltySummary?.next_tier?.min_lifetime_points ??
      Math.max(lifetime + (loyaltySummary?.points_to_next_tier ?? 0), 1);
    const pointsToNext = loyaltySummary?.points_to_next_tier ?? 0;
    const conversionLabel =
      loyaltySummary != null
        ? `${loyaltySummary.settings.conversion_points} pts = $${(
            loyaltySummary.settings.conversion_credit_cents / 100
          ).toFixed(2)}`
        : "—";
    const creditLabel =
      loyaltySummary != null
        ? `$${(Math.max(0, loyaltySummary.available_credit_cents) / 100).toFixed(2)}`
        : undefined;

    const last7dDelivered = items.filter((o) => {
      if (!o.created_at) return false;
      const time = new Date(o.created_at).getTime();
      const inLast7d =
        !Number.isNaN(time) && now - time <= 7 * 24 * 60 * 60 * 1000;
      return inLast7d && isDelivered(o.status);
    }).length;

    const missionTarget = 3;

    return {
      totalOrders,
      inProgress,
      delivered,
      canceled,
      last24h,
      points,
      level,
      nextLevelTarget,
      pointsToNext,
      last7dDelivered,
      missionTarget,
      conversionLabel,
      creditLabel,
      lifetimePoints: lifetime,
      tierProgressPct: loyaltySummary?.tier_progress_pct ?? 0,
    };
  }, [items, loyaltySummary]);

  const homeDisplayItems = useMemo(() => {
    return selectClientHomeDisplayItems(items).displayItems;
  }, [items]);

  const initials = useMemo(() => {
    const base = (displayName || DEFAULT_CLIENT_NAME).trim();
    const parts = base.split(" ").filter(Boolean);
    const a = parts[0]?.[0] ?? "C";
    const b = parts.length > 1 ? parts[1]?.[0] ?? "" : "";
    return (a + b).toUpperCase();
  }, [displayName]);

  const currentLang = (i18n.language || "en").split("-")[0];

  const changeLang = useCallback(
    async (lang: AppLanguageCode) => {
      try {
        await setLocaleForRoleAndApply("client", lang);
      } catch {
        try {
          await i18n.changeLanguage(lang);
        } catch {
          if (!isMountedRef.current) return;
          setError({
            key: "client.home.errors.lang_change_failed",
            fallback: "Unable to change language right now.",
          });
        }
      }
    },
    [i18n]
  );

  const handleGoToRoleSelect = useCallback(() => {
    setMenuOpen(false);
    navigation.reset({
      index: 0,
      routes: [{ name: "RoleSelect" as never }],
    });
  }, [navigation]);

  const handleSignOut = useCallback(async () => {
    if (signOutInFlightRef.current) return;
    signOutInFlightRef.current = true;

    try {
      if (isMountedRef.current) {
        setError(null);
        setMenuOpen(false);
      }

      await clearSelectedRole();

      if (realtimeChannelRef.current) {
        void unsubscribeSupabaseChannel(realtimeChannelRef.current);
        realtimeChannelRef.current = null;
      }

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;

      if (!isMountedRef.current) return;

      navigation.reset({
        index: 0,
        routes: [{ name: "RoleSelect" as never }],
      });
    } catch (e: unknown) {
      if (!isMountedRef.current) return;

      const message =
        e instanceof Error
          ? e.message
          : ts("common.errors.unknown", "Unknown error");

      setError({
        key: "client.home.errors.signout_failed",
        fallback: "Unable to sign out right now.",
        params: { message },
      });
    } finally {
      signOutInFlightRef.current = false;
    }
  }, [navigation, ts]);

  const progressBarWidth = progressWidth(
    Math.max(0, 100 - (stats.pointsToNext > 0 ? stats.pointsToNext : 0)),
    100,
  );
  const loyaltyProgressWidth: `${number}%` =
    stats.tierProgressPct != null
      ? (`${Math.max(0, Math.min(100, stats.tierProgressPct))}%` as `${number}%`)
      : progressBarWidth;

  const greeting = getGreeting(ts);
  const firstName = getFirstName(displayName || DEFAULT_CLIENT_NAME);

  const totalSpent = useMemo(() => {
    return items.reduce((sum, item) => {
      const amount = item.total ?? item.delivery_fee ?? 0;
      return sum + (Number.isFinite(amount) ? Number(amount) : 0);
    }, 0);
  }, [items]);

  const handleOpenFeaturedOrder = useCallback(() => {
    navigation.navigate("ClientOrderHistory" as never);
  }, [navigation]);

  const handleOpenRestaurantOrder = useCallback(
    (orderId: string) => {
      navigation.navigate("ClientOrderDetails", {
        orderId,
      });
    },
    [navigation]
  );

  const handleOpenChat = useCallback(
    (orderId: string) => {
      navigation.navigate("ClientChat", { orderId } as never);
    },
    [navigation]
  );

  const spendingAmount =
    totalSpent > 0 && market.scopeResolved
      ? formatCurrency(totalSpent, market.currencyCode)
      : totalSpent > 0
        ? formatCurrency(totalSpent, "USD")
        : null;

  const formatCurrencyForView = useCallback(
    (amount: number | null | undefined) =>
      formatCurrency(amount, market.currencyCode || "USD"),
    [market.currencyCode]
  );

  const handleNavigateMarketplace = useCallback(() => {
    if (platformFeatures.marketplace_available) {
      navigation.navigate("MarketplaceHome" as never);
      return;
    }
    Alert.alert(
      ts("client.home.banner.marketplace.title", "Marketplace"),
      comingSoonLabel
    );
  }, [comingSoonLabel, navigation, platformFeatures.marketplace_available, ts]);

  const handleOpenOrderItem = useCallback(
    (item: ClientItem) => {
      if (item.kind === "restaurant_order") {
        handleOpenRestaurantOrder(item.id);
        return;
      }
      if (item.kind === "taxi_ride") {
        navigation.navigate("TaxiRideTracking", { rideId: item.id } as never);
        return;
      }
      (navigation as any).navigate("ClientDeliveryRequestDetails", {
        requestId: item.id,
      });
    },
    [handleOpenRestaurantOrder, navigation]
  );

  return (
    <SafeAreaProvider>
      <View style={v4Styles.safe}>
        <StatusBar barStyle="dark-content" />
        <ClientHomeV4View
        ts={ts}
        loading={loading}
        refreshing={refreshing}
        items={homeDisplayItems}
        error={error}
        recentActivityUnavailable={recentActivityUnavailable}
        avatarUrl={avatarUrl}
        initials={initials}
        firstName={firstName}
        greeting={greeting}
        displayLocation={scopeLabel || ""}
        spendingAmount={spendingAmount}
        activeOrdersCount={stats.inProgress}
        platformFeatures={platformFeatures}
        comingSoonLabel={comingSoonLabel}
        marketplaceSoonLabel={marketplaceSoonLabel}
        scopeLabel={scopeLabel}
        showUseCurrentLocation={showUseCurrentLocation}
        areaLabel={areaLabel || profileAreaLabel}
        stats={stats}
        progressBarWidth={loyaltyProgressWidth}
        menuOpen={menuOpen}
        currentLang={currentLang}
        advertisements={advertisements}
        onAdImpression={(adId) => {
          void trackAdvertisementEvent({
            event: "impression",
            advertisementId: adId,
            country: market.countryCode || null,
            language: currentLang,
          });
        }}
        onAdClick={(ad) => {
          void trackAdvertisementEvent({
            event: "click",
            advertisementId: ad.id,
            country: market.countryCode || null,
            language: currentLang,
          });
          resolveClientAdAction(ad.button_action, {
            taxi: () => navigation.navigate("TaxiHome" as never),
            food: () => navigation.navigate("ClientRestaurantList" as never),
            delivery: () => navigation.navigate("DeliveryRequest" as never),
            marketplace: handleNavigateMarketplace,
            rewards: () =>
              navigation.navigate("LoyaltyHub", { role: "client" }),
            mmdPlus: () => navigation.navigate("MmdPlus" as never),
          });
        }}
        onRefresh={() => {
          void fetchOrders("refresh");
        }}
        onRefreshLocation={() => {
          void refreshWithCurrentLocation().then(() => {
            void refreshAreaLabel();
          });
        }}
        onChangeLang={changeLang}
        onCloseMenu={() => setMenuOpen(false)}
        onToggleMenu={() => setMenuOpen((prev) => !prev)}
        onSignOut={() => {
          void handleSignOut();
        }}
        onSwitchRole={handleGoToRoleSelect}
        onNavigateTaxi={() => navigation.navigate("TaxiHome" as never)}
        onNavigateFood={() => navigation.navigate("ClientRestaurantList" as never)}
        onNavigateDelivery={() => navigation.navigate("DeliveryRequest" as never)}
        onNavigateMarketplace={handleNavigateMarketplace}
        onNavigateInbox={() => navigation.navigate("ClientInbox" as never)}
        onNavigateProfile={() => navigation.navigate("ClientProfile" as never)}
        onNavigateOrders={handleOpenFeaturedOrder}
        onNavigateRewards={() =>
          navigation.navigate("LoyaltyHub", { role: "client" })
        }
        onNavigateMmdPlus={() => navigation.navigate("MmdPlus" as never)}
        onNavigateAi={() =>
          navigation.navigate("MmdAi", { source: "home_tab" })
        }
        onNavigateWallet={() =>
          navigation.navigate("LoyaltyHub", { role: "client" })
        }
        onOpenOrder={(item) => handleOpenOrderItem(item as ClientItem)}
        onOpenChat={handleOpenChat}
        formatCurrency={formatCurrencyForView}
        formatCompactDateTime={formatCompactDateTime}
        recentTitle={(item) => recentOrderTitle(item as ClientItem)}
        statusLabel={(item) => premiumStatusText(item as ClientItem, ts)}
        />
      </View>
    </SafeAreaProvider>
  );
}

export default ClientHomeScreen;
