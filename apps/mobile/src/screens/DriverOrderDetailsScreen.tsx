import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
  TextInput,
  Platform,
  Linking,
  Image,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "../lib/apiBase";
import { startMaskedCall } from "../lib/maskedCall";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

import {
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../lib/driverLocationTracker";
import { DriverTripLocationCard } from "../components/location/DriverTripLocationCard";
import {
  ensureMapboxTokenApplied,
  getMapStyleStreets,
} from "../lib/mapboxConfig";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverOrderDetails">;
type DriverOrderDetailsRoute = RouteProp<RootStackParamList, "DriverOrderDetails">;

type OrderStatus =
  | "pending"
  | "paid_pending"
  | "processing_pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "picked_up"
  | "delivered"
  | "canceled";

type Order = {
  id: string;
  kind: "pickup_dropoff" | "food" | "delivery" | string;
  status: OrderStatus;
  created_at: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  driver_delivery_payout: number | null;
  driver_id: string | null;
  client_id?: string | null;
  client_user_id?: string | null;
  restaurant_id?: string | null;
  restaurant_user_id?: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_location_id?: string | null;
  source_table?: "orders" | "delivery_requests" | "taxi_rides";
};

type VerifyKind = "pickup" | "dropoff";
type CommunicationTarget = "client" | "restaurant" | "admin";

type BasicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type RestaurantProfile = {
  id?: string | null;
  user_id?: string | null;
  restaurant_name?: string | null;
  business_name?: string | null;
  avatar_url?: string | null;
  logo_url?: string | null;
};

const AVATARS_BUCKET = "avatars";

function isHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function resolveStorageUrl(bucket: string, value: string | null | undefined) {
  const clean = String(value || "").trim();
  if (!clean) return null;
  if (isHttpUrl(clean)) return clean;

  const { data } = supabase.storage.from(bucket).getPublicUrl(clean);
  return data?.publicUrl || null;
}

function resolveAvatarUrl(value: string | null | undefined) {
  return resolveStorageUrl(AVATARS_BUCKET, value);
}

function initials(name: string) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "??";
}

function getProfileDisplayName(profile: BasicProfile | null, fallback: string, fallbackId?: string | null) {
  const name = profile?.full_name?.trim();
  if (name) return name;

  const id = String(fallbackId || "").trim();
  if (id) return `${fallback} ${id.slice(0, 8)}`;

  return fallback;
}

function getRestaurantDisplayName(profile: RestaurantProfile | null, fallback?: string | null) {
  const name =
    profile?.restaurant_name?.trim() ||
    profile?.business_name?.trim() ||
    String(fallback || "").trim();

  return name || "Restaurant";
}

type CancelOrderResponse = {
  ok?: boolean;
  cancelled?: boolean;
  by?: string;
  reassigned?: boolean;
  message?: string;
  error?: string;
};

const PROOF_BUCKET = "delivery-proofs";

const MAX_PROOF_PHOTO_BYTES = 8 * 1024 * 1024;
const FILE_SYSTEM_CACHE_DIRECTORY = String((FileSystem as any).cacheDirectory || "");

function sanitizeBase64(value: string) {
  return String(value || "")
    .replace(/^data:[^;]+;base64,/i, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/\s+/g, "");
}

function base64ToUint8Array(base64Value: string) {
  const base64 = sanitizeBase64(base64Value);
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const output: number[] = [];

  let buffer = 0;
  let bits = 0;

  for (let i = 0; i < base64.length; i += 1) {
    const char = base64[i];
    if (char === "=") break;

    const value = chars.indexOf(char);
    if (value < 0) continue;

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
}

function getFileSystemBase64Encoding(): "base64" | number {
  const encodingType = (FileSystem as any).EncodingType;
  if (encodingType?.Base64 != null) return encodingType.Base64;
  return "base64";
}

function getMimeTypeFromPhotoUri(photoUri: string) {
  const cleanUri = String(photoUri || "").trim();

  if (/^data:image\//i.test(cleanUri)) {
    return cleanUri.match(/^data:([^;]+);base64,/i)?.[1] || "image/jpeg";
  }

  const withoutQuery = cleanUri.split("?")[0]?.toLowerCase() || "";

  if (withoutQuery.endsWith(".png")) return "image/png";
  if (withoutQuery.endsWith(".webp")) return "image/webp";
  if (withoutQuery.endsWith(".heic")) return "image/heic";
  if (withoutQuery.endsWith(".heif")) return "image/heif";

  return "image/jpeg";
}

function getExtensionFromMimeType(mimeType: string) {
  const cleanMimeType = String(mimeType || "").toLowerCase();

  if (cleanMimeType.includes("png")) return "png";
  if (cleanMimeType.includes("webp")) return "webp";
  if (cleanMimeType.includes("heic")) return "heic";
  if (cleanMimeType.includes("heif")) return "heif";

  return "jpg";
}

function validateProofPhotoBytes(bytes: Uint8Array) {
  if (bytes.byteLength === 0) {
    throw new Error("PHOTO_EMPTY");
  }

  if (bytes.byteLength > MAX_PROOF_PHOTO_BYTES) {
    throw new Error("PHOTO_TOO_LARGE");
  }
}

async function resolveProofPhotoFileUri(photoUri: string): Promise<string> {
  const cleanUri = String(photoUri || "").trim();

  if (!cleanUri) {
    throw new Error("PHOTO_URI_MISSING");
  }

  if (/^data:image\//i.test(cleanUri)) {
    return cleanUri;
  }

  if (/^file:\/\//i.test(cleanUri)) {
    return cleanUri;
  }

  return copyProofPhotoToStableCache(cleanUri);
}

/** Lecture fiable Android/iOS : FileSystem base64 → Uint8Array (pas de fetch/Blob). */
async function readProofPhotoBytesFromLocalUri(
  photoUri: string
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const cleanUri = String(photoUri || "").trim();

  if (!cleanUri) {
    throw new Error("PHOTO_URI_MISSING");
  }

  const mimeType = getMimeTypeFromPhotoUri(cleanUri);

  if (/^data:image\//i.test(cleanUri)) {
    const bytes = base64ToUint8Array(cleanUri);
    validateProofPhotoBytes(bytes);
    return { bytes, mimeType };
  }

  const fileUri = await resolveProofPhotoFileUri(cleanUri);

  const info = await FileSystem.getInfoAsync(fileUri, { size: true } as any);

  if (!(info as any)?.exists) {
    throw new Error("PHOTO_FILE_NOT_FOUND");
  }

  const fileSize =
    typeof (info as any)?.size === "number" ? (info as any).size : null;

  if (fileSize != null && fileSize > MAX_PROOF_PHOTO_BYTES) {
    throw new Error("PHOTO_TOO_LARGE");
  }

  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(fileUri, {
      encoding: getFileSystemBase64Encoding(),
    } as any);
  } catch (readError) {
    console.log("[MMD_PROOF] readAsStringAsync failed:", readError);
    throw new Error("PHOTO_READ_FAILED");
  }

  const bytes = base64ToUint8Array(base64);
  validateProofPhotoBytes(bytes);

  return { bytes, mimeType };
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function copyProofPhotoToStableCache(photoUri: string) {
  const cleanUri = String(photoUri || "").trim();

  if (!cleanUri) {
    throw new Error("PHOTO_URI_MISSING");
  }

  if (/^data:image\//i.test(cleanUri)) {
    return cleanUri;
  }

  if (!FILE_SYSTEM_CACHE_DIRECTORY) {
    return cleanUri;
  }

  const mimeType = getMimeTypeFromPhotoUri(cleanUri);
  const destinationUri = `${FILE_SYSTEM_CACHE_DIRECTORY}mmd-proof-stable-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.${getExtensionFromMimeType(mimeType)}`;

  try {
    await FileSystem.copyAsync({
      from: cleanUri,
      to: destinationUri,
    });

    return destinationUri;
  } catch (error) {
    console.log("proof photo stable cache copy warning:", error);
    return cleanUri;
  }
}

async function prepareAndValidateProofPhotoUri(sourceUri: string) {
  const cleanSourceUri = String(sourceUri || "").trim();

  if (!cleanSourceUri) {
    throw new Error("PHOTO_URI_MISSING");
  }

  let candidateUri = cleanSourceUri;

  try {
    const manipulated = await ImageManipulator.manipulateAsync(
      cleanSourceUri,
      [{ resize: { width: 1280 } }],
      {
        compress: 0.55,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: false,
      }
    );

    const manipulatedUri = String(manipulated?.uri || "").trim();

    if (manipulatedUri) {
      candidateUri = manipulatedUri;
    }
  } catch (error) {
    console.log("proof photo manipulate warning:", error);
  }

  const stableUri = await copyProofPhotoToStableCache(candidateUri);

  try {
    await readProofPhotoBytesFromLocalUri(stableUri);
    return stableUri;
  } catch (firstError: any) {
    const firstMessage = String(firstError?.message ?? firstError ?? "");

    if (firstMessage === "PHOTO_TOO_LARGE" || firstMessage === "PHOTO_EMPTY") {
      throw firstError;
    }

    console.log("proof photo stable uri validation warning:", firstMessage);
  }

  if (stableUri !== cleanSourceUri) {
    const fallbackStableUri = await copyProofPhotoToStableCache(cleanSourceUri);
    await readProofPhotoBytesFromLocalUri(fallbackStableUri);
    return fallbackStableUri;
  }

  throw new Error("PHOTO_READ_FAILED");
}

function getProofPhotoErrorMessage(t: any, error: any) {
  const message = String(error?.message ?? error ?? "");

  if (message === "PHOTO_TOO_LARGE") {
    return t(
      "driver.orderDetails.photo.tooLarge",
      "La photo est trop grande. Reprends une photo plus légère."
    );
  }

  if (
    message === "PHOTO_EMPTY" ||
    message === "PHOTO_URI_MISSING" ||
    message === "PHOTO_READ_FAILED" ||
    message === "PHOTO_FILE_NOT_FOUND" ||
    message === "Photo URI missing." ||
    message === "Photo file not found."
  ) {
    return t(
      "driver.orderDetails.photo.readError",
      "Impossible de lire la photo. Reprends une nouvelle photo."
    );
  }

  return t(
    "driver.orderDetails.photo.readError",
    "Impossible de lire la photo. Reprends une nouvelle photo."
  );
}

type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type MapCoordinate = {
  latitude: number;
  longitude: number;
};

function coordinateToMapbox(coord: MapCoordinate): [number, number] {
  return [coord.longitude, coord.latitude];
}

function getTripLineFeature(coords: MapCoordinate[]) {
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates: coords.map(coordinateToMapbox),
    },
  };
}

function getRegionForTrip(
  pickupCoord: MapCoordinate | null,
  dropoffCoord: MapCoordinate | null,
  fallbackRegion: MapRegion
): { centerCoordinate: [number, number]; zoomLevel: number } {
  const coords = [pickupCoord, dropoffCoord].filter(Boolean) as MapCoordinate[];

  if (coords.length === 0) {
    return {
      centerCoordinate: [fallbackRegion.longitude, fallbackRegion.latitude],
      zoomLevel: 11,
    };
  }

  if (coords.length === 1) {
    return {
      centerCoordinate: coordinateToMapbox(coords[0]),
      zoomLevel: 14,
    };
  }

  const minLat = Math.min(...coords.map((c) => c.latitude));
  const maxLat = Math.max(...coords.map((c) => c.latitude));
  const minLng = Math.min(...coords.map((c) => c.longitude));
  const maxLng = Math.max(...coords.map((c) => c.longitude));

  const latDelta = Math.max(maxLat - minLat, 0.015);
  const lngDelta = Math.max(maxLng - minLng, 0.015);
  const maxDelta = Math.max(latDelta, lngDelta) * 1.8;
  const zoomLevel = Math.max(8, Math.min(15, Math.log2(360 / maxDelta)));

  return {
    centerCoordinate: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
    zoomLevel,
  };
}

function formatMoneyUSD(v: number | null) {
  if (v == null) return "—";
  return `${v.toFixed(2)} USD`;
}


function toFiniteNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getConfiguredDriverPayout(row: any) {
  const payoutCandidates = [
    row?.driver_delivery_payout,
    row?.driver_payout,
    row?.driver_amount,
    row?.driver_pay,
    row?.driver_earning,
    row?.driver_earnings,
    row?.estimated_driver_payout,
    row?.estimated_driver_pay,
    row?.estimated_driver_earning,
    row?.driver_share_amount,
    row?.payout_amount,
  ];

  for (const value of payoutCandidates) {
    const payout = toFiniteNumber(value);
    if (payout != null) return payout;
  }

  return null;
}

function normalizeSourceTable(
  value: unknown,
): "orders" | "delivery_requests" | "taxi_rides" {
  if (value === "delivery_requests") return "delivery_requests";
  if (value === "taxi_rides") return "taxi_rides";
  return "orders";
}

function getOrderSourceTable(order: Pick<Order, "source_table"> | null | undefined) {
  return normalizeSourceTable(order?.source_table);
}

function mapTaxiRideToOrder(row: any): Order {
  const payoutCents = Number(row?.driver_payout_cents ?? 0);
  const payout =
    Number.isFinite(payoutCents) && payoutCents > 0 ? payoutCents / 100 : null;

  return {
    id: String(row?.id ?? ""),
    kind: "taxi",
    status: String(row?.status ?? "pending") as OrderStatus,
    created_at: row?.created_at ?? null,
    restaurant_name: "MMD Taxi",
    pickup_address: row?.pickup_address ?? null,
    dropoff_address: row?.dropoff_address ?? null,
    distance_miles: toFiniteNumber(row?.distance_miles),
    eta_minutes:
      toFiniteNumber(row?.duration_minutes) ??
      toFiniteNumber(row?.eta_minutes),
    driver_delivery_payout: payout,
    driver_id: row?.driver_user_id ?? row?.driver_id ?? null,
    client_id: row?.client_user_id ?? null,
    client_user_id: row?.client_user_id ?? null,
    restaurant_id: null,
    restaurant_user_id: null,
    pickup_lat: toFiniteNumber(row?.pickup_lat),
    pickup_lng: toFiniteNumber(row?.pickup_lng ?? row?.pickup_lon),
    dropoff_lat: toFiniteNumber(row?.dropoff_lat),
    dropoff_lng: toFiniteNumber(row?.dropoff_lng ?? row?.dropoff_lon),
    dropoff_location_id: row?.dropoff_location_id ?? null,
    source_table: "taxi_rides",
  };
}

function mapDeliveryRequestToOrder(row: any): Order {
  return {
    id: String(row?.id ?? ""),
    kind: "delivery",
    status: String(row?.status ?? "pending") as OrderStatus,
    created_at: row?.created_at ?? null,
    restaurant_name: null,
    pickup_address: row?.pickup_address ?? null,
    dropoff_address: row?.dropoff_address ?? null,
    distance_miles: toFiniteNumber(row?.distance_miles),
    eta_minutes: toFiniteNumber(row?.eta_minutes),
    driver_delivery_payout: getConfiguredDriverPayout(row),
    driver_id: row?.driver_id ?? null,
    client_id: row?.client_id ?? row?.created_by ?? null,
    client_user_id: row?.client_user_id ?? row?.user_id ?? row?.created_by ?? null,
    restaurant_id: null,
    restaurant_user_id: null,
    pickup_lat: toFiniteNumber(row?.pickup_lat),
    pickup_lng: toFiniteNumber(row?.pickup_lng ?? row?.pickup_lon ?? row?.pickup_long ?? row?.pickup_longitude),
    dropoff_lat: toFiniteNumber(row?.dropoff_lat),
    dropoff_lng: toFiniteNumber(row?.dropoff_lng ?? row?.dropoff_lon ?? row?.dropoff_long ?? row?.dropoff_longitude),
    dropoff_location_id: row?.dropoff_location_id ?? null,
    source_table: "delivery_requests",
  };
}

function mapOrderRowToOrder(row: any): Order {
  return {
    ...(row as Order),
    source_table: "orders",
    driver_delivery_payout: getConfiguredDriverPayout(row),
  };
}


function formatMiles(v: number | null) {
  if (v == null) return "—";
  return `${v.toFixed(1)} mi`;
}

function formatMinutes(v: number | null) {
  if (v == null) return "—";
  return `${Math.round(v)} min`;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getApiBaseUrl() {
  const raw = String(API_BASE_URL || "").trim().replace(/\/+$/, "");

  if (!raw) {
    throw new Error("API_BASE_URL manquant.");
  }

  if (!/^https?:\/\//i.test(raw)) {
    throw new Error("API_BASE_URL doit être une URL absolue.");
  }

  return raw;
}

function normalizeKind(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isFinalStatus(status: OrderStatus) {
  return status === "delivered" || status === "canceled";
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

function normalizeVerificationCode(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase()
    .slice(0, 12);
}

function isAllowedDriverVisibleOrder(order: Order, driverId: string) {
  if (!driverId) return false;

  if (order.driver_id) {
    return order.driver_id === driverId;
  }

  const kind = normalizeKind(order.kind);
  const status = String(order.status || "").trim().toLowerCase();

  if (order.source_table === "delivery_requests" || kind === "delivery") {
    return status === "pending" || status === "paid_pending" || status === "processing_pending";
  }

  return (
    (kind === "pickup_dropoff" && status === "pending") ||
    (kind !== "pickup_dropoff" && status === "ready")
  );
}

export function DriverOrderDetailsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DriverOrderDetailsRoute>();
  const routeParams = route.params as any;
  const { orderId } = routeParams;
  const sourceTable = normalizeSourceTable(routeParams?.sourceTable ?? routeParams?.source_table);

  const { t } = useTranslation();

  useEffect(() => {
    ensureMapboxTokenApplied();
  }, []);

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [verifyingKind, setVerifyingKind] = useState<VerifyKind | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [proofPhotoUri, setProofPhotoUri] = useState<string | null>(null);
  const [proofPhotoPreparing, setProofPhotoPreparing] = useState(false);
  const [proofUploading, setProofUploading] = useState(false);
  const [calling, setCalling] = useState<CommunicationTarget | null>(null);
  const [clientProfile, setClientProfile] = useState<BasicProfile | null>(null);
  const [clientProfileLoading, setClientProfileLoading] = useState(false);
  const [restaurantProfile, setRestaurantProfile] = useState<RestaurantProfile | null>(null);
  const [restaurantProfileLoading, setRestaurantProfileLoading] = useState(false);

  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const didFitRef = useRef(false);

  const normalizedKind = useMemo(() => normalizeKind(order?.kind), [order?.kind]);
  const isPickupDropoff = normalizedKind === "pickup_dropoff";
  const isDeliveryRequest = order?.source_table === "delivery_requests" || normalizedKind === "delivery";

  const pickupCoord = useMemo(() => {
    if (!isValidCoordinate(order?.pickup_lat, order?.pickup_lng)) return null;
    return { latitude: Number(order?.pickup_lat), longitude: Number(order?.pickup_lng) };
  }, [order?.pickup_lat, order?.pickup_lng]);

  const dropoffCoord = useMemo(() => {
    if (!isValidCoordinate(order?.dropoff_lat, order?.dropoff_lng)) return null;
    return { latitude: Number(order?.dropoff_lat), longitude: Number(order?.dropoff_lng) };
  }, [order?.dropoff_lat, order?.dropoff_lng]);

  const polylineCoords = useMemo(() => {
    const coords: { latitude: number; longitude: number }[] = [];
    if (pickupCoord) coords.push(pickupCoord);
    if (dropoffCoord) coords.push(dropoffCoord);
    return coords;
  }, [pickupCoord, dropoffCoord]);

  const fallbackRegion: MapRegion = useMemo(
    () => ({
      latitude: 40.650002,
      longitude: -73.949997,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    }),
    []
  );

  const tripCamera = useMemo(
    () => getRegionForTrip(pickupCoord, dropoffCoord, fallbackRegion),
    [pickupCoord, dropoffCoord, fallbackRegion]
  );

  const tripLineFeature = useMemo(() => getTripLineFeature(polylineCoords), [polylineCoords]);

  const fitMapToTrip = useCallback(() => {
    cameraRef.current?.setCamera({
      centerCoordinate: tripCamera.centerCoordinate,
      zoomLevel: tripCamera.zoomLevel,
      animationDuration: 600,
      animationMode: "flyTo",
    });
  }, [tripCamera.centerCoordinate, tripCamera.zoomLevel]);

  function formatStatusLabel(currentOrder: Order) {
    const kind = normalizeKind(currentOrder.kind);

    if (kind === "pickup_dropoff") {
      switch (currentOrder.status) {
        case "pending":
          return t("driver.orderDetails.status.pd_pending", "En attente d’un chauffeur");
        case "accepted":
          return t("driver.orderDetails.status.pd_accepted", "Pickup à confirmer");
        case "prepared":
          return t("driver.orderDetails.status.pd_prepared", "Pickup à confirmer");
        case "ready":
          return t("driver.orderDetails.status.pd_ready", "Pickup prêt à confirmer");
        case "dispatched":
          return t("driver.orderDetails.status.pd_dispatched", "En route vers le destinataire");
        case "delivered":
          return t("driver.orderDetails.status.delivered", "Livrée");
        case "canceled":
          return t("driver.orderDetails.status.canceled", "Annulée");
        default:
          return currentOrder.status;
      }
    }

    switch (currentOrder.status) {
      case "pending":
      case "paid_pending":
      case "processing_pending":
        return t("driver.orderDetails.status.pending", "En attente d’un chauffeur");
      case "accepted":
      case "prepared":
        return t("driver.orderDetails.status.accepted_prepared", "En attente (restaurant)");
      case "ready":
        return t("driver.orderDetails.status.ready", "Prête pour retrait");
      case "dispatched":
        return t("driver.orderDetails.status.dispatched", "En livraison");
      case "picked_up":
        return t("driver.orderDetails.status.picked_up", "Colis récupéré — en route");
      case "delivered":
        return t("driver.orderDetails.status.delivered", "Livrée");
      case "canceled":
        return t("driver.orderDetails.status.canceled", "Annulée");
      default:
        return currentOrder.status;
    }
  }

  function statusBadgeStyle(status: OrderStatus) {
    if (status === "delivered") {
      return { bg: "#064E3B", border: "#10B981", text: "#A7F3D0" };
    }
    if (status === "dispatched") {
      return { bg: "#422006", border: "#F59E0B", text: "#FDE68A" };
    }
    if (status === "picked_up") {
      return { bg: "#312E81", border: "#818CF8", text: "#E0E7FF" };
    }
    if (status === "ready") {
      return { bg: "#1E293B", border: "#60A5FA", text: "#BFDBFE" };
    }
    if (status === "accepted" || status === "prepared") {
      return { bg: "#172554", border: "#3B82F6", text: "#BFDBFE" };
    }
    if (status === "canceled") {
      return { bg: "#7F1D1D", border: "#FCA5A5", text: "#FECACA" };
    }
    return { bg: "#111827", border: "#374151", text: "#E5E7EB" };
  }

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError) throw userError;

        const uid = user?.id ?? null;

        if (!mounted) return;

        if (!uid) {
          setMyUserId(null);
          navigation.reset({ index: 0, routes: [{ name: "RoleSelect" as any }] });
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", uid)
          .maybeSingle();

        if (profileError) {
          console.log("DriverOrderDetails role check error:", profileError);
        }

        const role = String((profile as any)?.role || "").trim().toLowerCase();

        if (role && role !== "driver") {
          setMyUserId(null);
          navigation.reset({
            index: 0,
            routes: [
              {
                name:
                  role === "restaurant"
                    ? ("RestaurantGate" as any)
                    : role === "client"
                      ? ("ClientHome" as any)
                      : ("RoleSelect" as any),
              },
            ],
          });
          return;
        }

        setMyUserId(uid);
      } catch (e) {
        if (!mounted) return;
        setMyUserId(null);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [navigation]);

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;

      const uid = user?.id ?? null;

      if (!uid) {
        throw new Error(t("common.mustBeLoggedIn", "Tu dois être connecté."));
      }

      let nextOrder: Order | null = null;

      if (sourceTable === "delivery_requests") {
        const { data, error } = await supabase
          .from("delivery_requests")
          .select(
            `id,status,payment_status,driver_id,created_at,updated_at,
             created_by,client_user_id,user_id,
             pickup_address,dropoff_address,
             pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,dropoff_location_id,
             distance_miles,eta_minutes,delivery_fee,total,currency,
             driver_delivery_payout,platform_fee,
             pickup_code,dropoff_code,picked_up_at,delivered_at`
          )
          .eq("id", orderId)
          .maybeSingle();

        if (error) throw error;
        if (data) nextOrder = mapDeliveryRequestToOrder(data);
      } else if (sourceTable === "taxi_rides") {
        const { data, error } = await supabase
          .from("taxi_rides")
          .select(
            `id,status,payment_status,driver_user_id,client_user_id,created_at,updated_at,
             pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,
             pickup_location_id,dropoff_location_id,distance_miles,duration_minutes,
             driver_payout_cents,total_cents,currency`
          )
          .eq("id", orderId)
          .maybeSingle();

        if (error) throw error;
        if (data) nextOrder = mapTaxiRideToOrder(data);
      } else {
        const { data, error } = await supabase
          .from("orders")
          .select(
            `
            id,
            kind,
            status,
            created_at,
            restaurant_name,
            pickup_address,
            dropoff_address,
            distance_miles,
            eta_minutes,
            driver_delivery_payout,
            driver_id,
            client_id,
            client_user_id,
            restaurant_id,
            restaurant_user_id,
            pickup_lat,
            pickup_lng,
            dropoff_lat,
            dropoff_lng
          `
          )
          .eq("id", orderId)
          .maybeSingle();

        if (error) throw error;
        if (data) nextOrder = mapOrderRowToOrder(data);
      }

      if (!nextOrder) {
        Alert.alert(
          t("common.error", "Erreur"),
          t("driver.orderDetails.notFound", "Commande introuvable.")
        );
        navigation.goBack();
        return;
      }

      if (!isAllowedDriverVisibleOrder(nextOrder, uid)) {
        throw new Error(
          t(
            "driver.orderDetails.notAllowed",
            "Cette course n’est pas disponible pour ce compte chauffeur."
          )
        );
      }

      setOrder(nextOrder);
      setMyUserId(uid);
      didFitRef.current = false;
    } catch (e: any) {
      console.error("Erreur fetch driver order details:", e);
      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ??
          t(
            "driver.orderDetails.loadError",
            "Impossible de charger les détails de la commande."
          )
      );
    } finally {
      setLoading(false);
    }
  }, [orderId, sourceTable, navigation, t]);

  const fetchProfileById = useCallback(async (profileId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, avatar_url")
      .eq("id", profileId)
      .maybeSingle();

    if (error) throw error;
    return (data as unknown as BasicProfile) ?? null;
  }, []);

  const fetchClientProfile = useCallback(
    async (clientId: string) => {
      setClientProfileLoading(true);

      try {
        const profile = await fetchProfileById(clientId);
        setClientProfile(profile);
      } catch {
        setClientProfile(null);
      } finally {
        setClientProfileLoading(false);
      }
    },
    [fetchProfileById]
  );

  const fetchRestaurantProfile = useCallback(async (currentOrder: Order) => {
    const restaurantUserId = String(currentOrder.restaurant_user_id || "").trim();
    const restaurantId = String(currentOrder.restaurant_id || "").trim();

    if (!restaurantUserId && !restaurantId) {
      setRestaurantProfile(null);
      return;
    }

    setRestaurantProfileLoading(true);

    try {
      if (restaurantUserId) {
        const { data, error } = await supabase
          .from("restaurant_profiles")
          .select("id, user_id, restaurant_name, business_name, avatar_url, logo_url")
          .eq("user_id", restaurantUserId)
          .maybeSingle();

        if (!error && data) {
          setRestaurantProfile(data as RestaurantProfile);
          return;
        }
      }

      if (restaurantId) {
        const { data, error } = await supabase
          .from("restaurant_profiles")
          .select("id, user_id, restaurant_name, business_name, avatar_url, logo_url")
          .eq("id", restaurantId)
          .maybeSingle();

        if (error) throw error;
        setRestaurantProfile((data as RestaurantProfile) ?? null);
        return;
      }

      setRestaurantProfile(null);
    } catch {
      setRestaurantProfile(null);
    } finally {
      setRestaurantProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    const clientId = order?.client_user_id ?? order?.client_id ?? null;

    if (!clientId) {
      setClientProfile(null);
      return;
    }

    void fetchClientProfile(clientId);
  }, [order?.client_id, order?.client_user_id, fetchClientProfile]);

  useEffect(() => {
    if (!order || isPickupDropoff) {
      setRestaurantProfile(null);
      return;
    }

    void fetchRestaurantProfile(order);
  }, [order, isPickupDropoff, fetchRestaurantProfile]);

  useEffect(() => {
    void fetchOrder();

    return () => {
      stopDriverLocationTracking();
    };
  }, [fetchOrder]);

  useFocusEffect(
    useCallback(() => {
      void fetchOrder();
      const timer = setTimeout(() => {
        void fetchOrder();
      }, 2000);
      return () => clearTimeout(timer);
    }, [fetchOrder])
  );

  useEffect(() => {
    if (!order) return;
    if (didFitRef.current) return;

    if (pickupCoord || dropoffCoord) {
      const tm = setTimeout(() => {
        fitMapToTrip();
        didFitRef.current = true;
      }, 250);
      return () => clearTimeout(tm);
    }
  }, [order, pickupCoord, dropoffCoord, fitMapToTrip]);

  useEffect(() => {
    if (!order || !myUserId) return;

    const isMine = order.driver_id === myUserId;
    const inProgress =
      order.status === "accepted" ||
      order.status === "prepared" ||
      order.status === "ready" ||
      order.status === "dispatched";

    if (!isMine || !inProgress) {
      stopDriverLocationTracking();
      return;
    }

    startDriverLocationTracking({ driverId: myUserId }).catch((e) => {
      console.log("startDriverLocationTracking error:", e?.message ?? e);
    });

    return () => {
      stopDriverLocationTracking();
    };
  }, [order?.status, order?.driver_id, myUserId]);

  function openMapsSingle(params: {
    address: string | null;
    lat: number | null;
    lng: number | null;
  }) {
    const { address, lat, lng } = params;

    if (isValidCoordinate(lat, lng)) {
      const url =
        Platform.OS === "ios"
          ? `http://maps.apple.com/?daddr=${lat},${lng}`
          : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;

      Linking.openURL(url).catch((err) => {
        console.error("Erreur ouverture Maps (coords):", err);
        Alert.alert(
          t("common.error", "Erreur"),
          t(
            "driver.orderDetails.mapsOpenError",
            "Impossible d'ouvrir l'application de navigation sur ce téléphone."
          )
        );
      });
      return;
    }

    if (!address) {
      Alert.alert(
        t("driver.orderDetails.missingAddressTitle", "Adresse manquante"),
        t(
          "driver.orderDetails.missingAddressBody",
          "Aucune adresse disponible pour cette étape."
        )
      );
      return;
    }

    const encoded = encodeURIComponent(address);
    const url =
      Platform.OS === "ios"
        ? `http://maps.apple.com/?daddr=${encoded}`
        : `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;

    Linking.openURL(url).catch((err) => {
      console.error("Erreur ouverture Maps:", err);
      Alert.alert(
        t("common.error", "Erreur"),
        t(
          "driver.orderDetails.mapsOpenError",
          "Impossible d'ouvrir l'application de navigation sur ce téléphone."
        )
      );
    });
  }

  function openMmdNavigation() {
    if (!order) return;

    if (!isAssignedDriver) {
      Alert.alert(
        t("driver.orderDetails.navigation.unavailableTitle", "Navigation indisponible"),
        t(
          "driver.orderDetails.navigation.mustAcceptFirst",
          "Accepte d'abord cette course avant de démarrer la navigation MMD."
        )
      );
      return;
    }

    if (!pickupCoord && !dropoffCoord) {
      Alert.alert(
        t("driver.orderDetails.missingCoordsTitle", "Infos manquantes"),
        t(
          "driver.orderDetails.missingCoordsBody",
          "Cette course n’a pas encore de coordonnées GPS."
        )
      );
      return;
    }

    (navigation as any).navigate("DriverMap", {
      orderId: order.id,
      sourceTable: getOrderSourceTable(order),
      destinationStage: canDeliver ? "dropoff" : "pickup",
    });
  }

  function openWazeSingle(params: {
    address: string | null;
    lat: number | null;
    lng: number | null;
  }) {
    const { address, lat, lng } = params;

    const hasCoords = isValidCoordinate(lat, lng);
    const encodedAddress = encodeURIComponent(String(address || "").trim());

    if (!hasCoords && !encodedAddress) {
      Alert.alert(
        t("driver.orderDetails.missingAddressTitle", "Adresse manquante"),
        t(
          "driver.orderDetails.missingAddressBody",
          "Aucune adresse disponible pour cette étape."
        )
      );
      return;
    }

    const deepLink = hasCoords
      ? `waze://?ll=${lat},${lng}&navigate=yes`
      : `waze://?q=${encodedAddress}&navigate=yes`;

    const fallbackUrl = hasCoords
      ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
      : `https://waze.com/ul?q=${encodedAddress}&navigate=yes`;

    Linking.openURL(deepLink).catch(() => {
      Linking.openURL(fallbackUrl).catch((err) => {
        console.error("Erreur ouverture Waze:", err);
        Alert.alert(
          t("common.error", "Erreur"),
          t(
            "driver.orderDetails.wazeOpenError",
            "Impossible d'ouvrir Waze sur ce téléphone."
          )
        );
      });
    });
  }

  function openMapsPickup() {
    openMapsSingle({
      address: order?.pickup_address ?? null,
      lat: order?.pickup_lat ?? null,
      lng: order?.pickup_lng ?? null,
    });
  }

  function openMapsDropoff() {
    openMapsSingle({
      address: order?.dropoff_address ?? null,
      lat: order?.dropoff_lat ?? null,
      lng: order?.dropoff_lng ?? null,
    });
  }

  function openWazePickup() {
    openWazeSingle({
      address: order?.pickup_address ?? null,
      lat: order?.pickup_lat ?? null,
      lng: order?.pickup_lng ?? null,
    });
  }

  function openWazeDropoff() {
    openWazeSingle({
      address: order?.dropoff_address ?? null,
      lat: order?.dropoff_lat ?? null,
      lng: order?.dropoff_lng ?? null,
    });
  }

  const isAssignedDriver =
    !!order && !!myUserId && !!order.driver_id && order.driver_id === myUserId;

  const canPickup =
    !!order &&
    isAssignedDriver &&
    (
      (isDeliveryRequest && order.status === "dispatched") ||
      (!isDeliveryRequest &&
        ((isPickupDropoff && ["accepted", "prepared", "ready"].includes(order.status)) ||
          (!isPickupDropoff && order.status === "ready")))
    );

  const canDeliver =
    !!order &&
    isAssignedDriver &&
    ((isDeliveryRequest && order.status === "picked_up") ||
      (!isDeliveryRequest && order.status === "dispatched"));

  const canAccept =
    !!order &&
    !!myUserId &&
    !accepting &&
    !canceling &&
    !submittingCode &&
    !proofUploading &&
    !proofPhotoPreparing &&
    !order.driver_id &&
    (
      (isDeliveryRequest && ["pending", "paid_pending", "processing_pending"].includes(order.status)) ||
      (isPickupDropoff && order.status === "pending") ||
      (!isDeliveryRequest && !isPickupDropoff && order.status === "ready")
    );

  const canCancelAsDriver =
    !!order &&
    isAssignedDriver &&
    !canceling &&
    !submittingCode &&
    !proofUploading &&
    !proofPhotoPreparing &&
    (
      (isDeliveryRequest && order.status === "dispatched") ||
      (!isDeliveryRequest && (order.status === "accepted" || order.status === "ready"))
    );

  function openCodeModal(kind: VerifyKind) {
    if (kind === "pickup" && !canPickup) return;
    if (kind === "dropoff" && !canDeliver) return;
    setCodeInput("");
    setProofPhotoUri(null);
    setVerifyingKind(kind);
  }

  function closeCodeModal() {
    setVerifyingKind(null);
    setCodeInput("");
    setProofPhotoUri(null);
    setProofPhotoPreparing(false);
    setSubmittingCode(false);
    setProofUploading(false);
  }

  // Production privacy rule:
  // The driver must only see the exact driver payout.
  // Do not fetch, calculate, or display customer total, delivery_fee,
  // platform_delivery_fee, restaurant revenue, or platform revenue here.
  const driverPart = getConfiguredDriverPayout(order);

  async function takeProofPhoto() {
    if (proofPhotoPreparing || proofUploading || submittingCode) return;

    try {
      setProofPhotoPreparing(true);
      setProofPhotoUri(null);

      const permission = await ImagePicker.requestCameraPermissionsAsync();

      if (permission.status !== "granted") {
        Alert.alert(
          t("driver.orderDetails.photo.permissionTitle", "Caméra"),
          t(
            "driver.orderDetails.photo.permissionBody",
            "Autorise la caméra pour prendre une photo de preuve."
          )
        );
        return;
      }

      const mediaTypes =
        (ImagePicker as any)?.MediaType?.Images ??
        (ImagePicker as any)?.MediaTypeOptions?.Images ??
        "images";

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes,
        allowsEditing: false,
        quality: 0.65,
        base64: false,
        exif: false,
      } as any);

      if (result.canceled || !result.assets?.length) {
        return;
      }

      const sourceUri = String(result.assets[0]?.uri || "").trim();

      if (!sourceUri) {
        throw new Error("PHOTO_URI_MISSING");
      }

      const finalUri = await prepareAndValidateProofPhotoUri(sourceUri);

      setProofPhotoUri(finalUri);
    } catch (e: any) {
      console.log("takeProofPhoto error:", e);
      setProofPhotoUri(null);
      Alert.alert(
        t("common.error", "Erreur"),
        getProofPhotoErrorMessage(t, e)
      );
    } finally {
      setProofPhotoPreparing(false);
    }
  }

  async function uploadProofPhoto(params: {
    orderId: string;
    kind: VerifyKind;
    photoUri: string;
  }) {
    const { orderId: currentOrderId, kind, photoUri } = params;

    console.log("[MMD_PROOF] uploadProofPhoto START", {
      orderId: currentOrderId,
      kind,
      uri: photoUri?.slice(0, 80),
    });

    setProofUploading(true);
    try {
      const { bytes, mimeType } = await readProofPhotoBytesFromLocalUri(photoUri).catch(
        (e: any) => {
          throw new Error(getProofPhotoErrorMessage(t, e));
        }
      );

      const uid = myUserId || "unknown-driver";
      const contentType = mimeType || getMimeTypeFromPhotoUri(photoUri);
      const ext = getExtensionFromMimeType(contentType);
      const filePath = `${currentOrderId}/${uid}/${kind}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;

      console.log("[MMD_PROOF] STEP storage.upload REACHED", {
        bucket: PROOF_BUCKET,
        filePath,
        byteSize: bytes.byteLength,
        contentType,
      });

      let uploadError: { message?: string; name?: string; status?: unknown; statusCode?: unknown } | null =
        null;

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const { error } = await supabase.storage.from(PROOF_BUCKET).upload(filePath, bytes, {
          contentType,
          upsert: false,
        });

        if (!error) {
          uploadError = null;
          break;
        }

        uploadError = error;
        console.log("[MMD_PROOF] STEP storage.upload attempt failed", {
          attempt,
          message: error.message,
          name: error.name,
          status: (error as any)?.status,
          statusCode: (error as any)?.statusCode,
        });

        if (attempt < 3) {
          await sleepMs(500 * attempt);
        }
      }

      if (uploadError) {
        console.log("[MMD_PROOF] STEP storage.upload FAIL", {
          message: uploadError.message,
          name: uploadError.name,
          status: uploadError.status,
          statusCode: uploadError.statusCode,
        });
        throw uploadError;
      }

      console.log("[MMD_PROOF] STEP storage.upload OK", { filePath });

      const { data: signedData, error: signErr } = await supabase.storage
        .from(PROOF_BUCKET)
        .createSignedUrl(filePath, 60 * 60 * 24 * 7);

      if (signErr) {
        console.warn("[MMD_PROOF] createSignedUrl failed", signErr);
      }

      const signedUrl = signedData?.signedUrl ?? null;

      console.log("[MMD_PROOF] uploadProofPhoto DONE", {
        storagePath: filePath,
        signedUrl: signedUrl?.slice(0, 80),
      });

      return {
        storagePath: filePath,
        publicUrl: signedUrl,
      };
    } finally {
      setProofUploading(false);
    }
  }

  async function callConfirmRoute(
    kind: VerifyKind,
    currentOrderId: string,
    proofPhotoUrl: string | null
  ) {
    const { data: sessionData, error: sessionError } =
      await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(
        sessionError.message ||
          t("driver.orderDetails.sessionError", "Impossible de récupérer la session.")
      );
    }

    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new Error(
        t("driver.orderDetails.tokenMissing", "Token de session manquant.")
      );
    }

    const apiBaseUrl = getApiBaseUrl();

    const endpoint =
      kind === "pickup"
        ? `${apiBaseUrl}/api/orders/pickup-confirm`
        : `${apiBaseUrl}/api/orders/delivered-confirm`;

    console.log("[MMD_PROOF] callConfirmRoute START", {
      kind,
      orderId: currentOrderId,
      proofPhotoUrl: proofPhotoUrl?.slice(0, 120),
      apiBaseUrl,
      endpoint,
    });

    console.log("[MMD_PROOF] STEP fetch confirm REACHED");

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          order_id: currentOrderId,
          proof_photo_url: proofPhotoUrl,
          driver_id: myUserId,
        }),
      });
    } catch (fetchErr: any) {
      console.log("[MMD_PROOF] STEP fetch confirm NETWORK_FAIL", {
        message: fetchErr?.message,
        name: fetchErr?.name,
      });
      throw fetchErr;
    }

    console.log("[MMD_PROOF] STEP fetch confirm RESPONSE", {
      status: response.status,
      ok: response.ok,
    });

    const result = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        result?.error ||
          (kind === "pickup"
            ? t(
                "driver.orderDetails.pickupConfirmError",
                "Échec de la confirmation du pickup."
              )
            : t(
                "driver.orderDetails.deliveryConfirmError",
                "Échec de la confirmation de la livraison."
              ))
      );
    }

    return result;
  }

  async function handleAccept() {
    if (!order || !myUserId || accepting) return;

    if (!canAccept) {
      Alert.alert(
        t("driver.orderDetails.acceptDeniedTitle", "Impossible d'accepter"),
        t(
          "driver.orderDetails.acceptDeniedGeneric",
          "Impossible d'accepter cette course."
        )
      );
      return;
    }

    try {
      setAccepting(true);

      if (getOrderSourceTable(order) === "delivery_requests") {
        const { acceptDeliveryRequest } = await import("../lib/deliveryRequestDriverApi");
        await acceptDeliveryRequest(order.id);
      } else {
        const { data: accepted, error: accErr } = await supabase.rpc("driver_accept_ready_order", {
          p_order_id: order.id,
        });

        if (accErr) {
          console.error("❌ accept_order error:", accErr);
          Alert.alert(
            t("driver.orderDetails.acceptDeniedTitle", "Impossible d'accepter"),
            accErr.message?.includes("Stripe onboarding required")
              ? t(
                  "driver.orderDetails.acceptDeniedStripe",
                  "Tu dois terminer la configuration Stripe avant d'accepter des courses."
                )
              : accErr.message ??
                  t(
                    "driver.orderDetails.acceptDeniedGeneric",
                    "Impossible d'accepter cette course."
                  )
          );
          return;
        }

        console.log("✅ Course acceptée via RPC:", (accepted as any)?.id ?? accepted);
      }

      const uid =
        myUserId ?? (await supabase.auth.getUser()).data?.user?.id ?? null;

      if (uid) {
        startDriverLocationTracking({ driverId: uid }).catch((e) => {
          console.log("startDriverLocationTracking error:", e?.message ?? e);
        });
      }

      await fetchOrder();

      Alert.alert(
        t("driver.orderDetails.acceptedTitle", "Course acceptée ✅"),
        t(
          "driver.orderDetails.acceptedBody",
          "Tu es maintenant assigné à cette course."
        )
      );
    } catch (e: any) {
      console.error("Erreur handleAccept:", e);
      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ??
          t(
            "driver.orderDetails.acceptError",
            "Impossible d'accepter la course pour le moment."
          )
      );
    } finally {
      setAccepting(false);
    }
  }

  async function handleCancelAsDriver() {
    if (!order) return;

    if (!canCancelAsDriver) {
      Alert.alert(
        t("driver.orderDetails.cancel.unavailableTitle", "Annulation indisponible"),
        t(
          "driver.orderDetails.cancel.unavailableBody",
          "Tu peux annuler seulement avant le pickup, quand la course est encore acceptée ou prête."
        )
      );
      return;
    }

    Alert.alert(
      t("driver.orderDetails.cancel.title", "Annuler la course ?"),
      t(
        "driver.orderDetails.cancel.body",
        "Si tu annules maintenant, tu seras retiré de cette course et elle pourra être proposée à un autre chauffeur."
      ),
      [
        {
          text: t("common.no", "Non"),
          style: "cancel",
        },
        {
          text: t("driver.orderDetails.cancel.confirm", "Oui, annuler"),
          style: "destructive",
          onPress: async () => {
            try {
              setCanceling(true);

              if (getOrderSourceTable(order) === "delivery_requests") {
                const { cancelDeliveryRequestAsDriver } = await import(
                  "../lib/deliveryRequestDriverApi"
                );
                await cancelDeliveryRequestAsDriver(order.id);

                stopDriverLocationTracking();
                await fetchOrder();

                Alert.alert(
                  t("driver.orderDetails.cancel.successTitle", "Course annulée"),
                  t(
                    "driver.orderDetails.cancel.successBody",
                    "Tu as été retiré de cette course. Elle peut maintenant être prise par un autre chauffeur."
                  )
                );

                navigation.goBack();
                return;
              }

              const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

              if (sessionError) {
                throw new Error(sessionError.message);
              }

              const token = sessionData?.session?.access_token;
              if (!token) {
                throw new Error(
                  t("driver.orderDetails.tokenMissing", "Token de session manquant.")
                );
              }

              const apiBaseUrl = getApiBaseUrl();
              const endpoint = `${apiBaseUrl}/api/orders/cancel`;

              const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  orderId: order.id,
                  order_id: order.id,
                  role: "driver",
                }),
              });

              const result = (await response.json().catch(() => ({}))) as CancelOrderResponse;

              if (!response.ok || !result?.ok) {
                throw new Error(
                  result?.error ??
                    t("driver.orderDetails.cancel.error", "Impossible d'annuler cette course.")
                );
              }

              stopDriverLocationTracking();
              await fetchOrder();

              Alert.alert(
                t("driver.orderDetails.cancel.successTitle", "Course annulée"),
                result?.message ??
                  t(
                    "driver.orderDetails.cancel.successBody",
                    "Tu as été retiré de cette course. Elle peut maintenant être prise par un autre chauffeur."
                  )
              );

              navigation.goBack();
            } catch (e: any) {
              Alert.alert(
                t("common.error", "Erreur"),
                e?.message ??
                  t("driver.orderDetails.cancel.error", "Impossible d'annuler cette course.")
              );
            } finally {
              setCanceling(false);
            }
          },
        },
      ]
    );
  }

  async function handleSubmitCode() {
    if (!order || !verifyingKind || !myUserId || !isAssignedDriver) return;

    const normalizedCode = normalizeVerificationCode(codeInput);

    if (!normalizedCode) {
      Alert.alert(
        t("driver.orderDetails.codeMissingTitle", "Code manquant"),
        t("driver.orderDetails.codeMissingBody", "Entre le code de vérification.")
      );
      return;
    }

    if (!proofPhotoUri) {
      Alert.alert(
        t("driver.orderDetails.photo.requiredTitle", "Photo requise"),
        t(
          "driver.orderDetails.photo.requiredBody",
          "Prends une photo de preuve avant de valider."
        )
      );
      return;
    }

    if (proofPhotoPreparing) {
      Alert.alert(
        t("driver.orderDetails.photo.preparingTitle", "Photo en préparation"),
        t(
          "driver.orderDetails.photo.preparingBody",
          "Attends que la photo soit prête avant de valider."
        )
      );
      return;
    }

    try {
      setSubmittingCode(true);

      console.log("[MMD_PROOF] handleSubmitCode START", {
        orderId: order?.id,
        source: getOrderSourceTable(order),
        kind: verifyingKind,
        proofPhotoUri: proofPhotoUri?.slice(0, 80),
      });

      try {
        const precheck = await readProofPhotoBytesFromLocalUri(proofPhotoUri);
        console.log("[MMD_PROOF] STEP photo precheck OK", {
          byteSize: precheck.bytes.byteLength,
        });
      } catch (photoCheckError: any) {
        console.log("[MMD_PROOF] STEP photo precheck FAIL", {
          message: photoCheckError?.message,
          name: photoCheckError?.name,
        });
        setProofPhotoUri(null);
        Alert.alert(
          t("common.error", "Erreur"),
          getProofPhotoErrorMessage(t, photoCheckError)
        );
        return;
      }

      const kind = verifyingKind;

      if (getOrderSourceTable(order) === "delivery_requests") {
        const uploaded = await uploadProofPhoto({
          orderId: order.id,
          kind,
          photoUri: proofPhotoUri,
        });

        const {
          confirmDeliveryRequestPickup,
          confirmDeliveryRequestDelivered,
        } = await import("../lib/deliveryRequestDriverApi");

        if (kind === "pickup") {
          await confirmDeliveryRequestPickup({
            deliveryRequestId: order.id,
            pickupCode: normalizedCode,
            proofPhotoUrl: uploaded.publicUrl,
          });
        } else {
          await confirmDeliveryRequestDelivered({
            deliveryRequestId: order.id,
            dropoffCode: normalizedCode,
            proofPhotoUrl: uploaded.publicUrl,
          });
        }

        await fetchOrder();
        closeCodeModal();

        Alert.alert(
          t("common.success", "Succès"),
          kind === "pickup"
            ? t("driver.orderDetails.codePickupOk", "Code de retrait validé ✅")
            : t("driver.orderDetails.codeDropoffOk", "Code de livraison validé ✅")
        );
        return;
      }

      const uploaded = await uploadProofPhoto({
        orderId: order.id,
        kind,
        photoUri: proofPhotoUri,
      });

      console.log("[MMD_PROOF] STEP verify_order_code CALL", {
        orderId: order.id,
        kind,
        codeLen: normalizedCode.length,
      });

      const { data, error } = await supabase.rpc("verify_order_code", {
        p_order_id: order.id,
        p_input_code: normalizedCode,
        p_code_type: kind,
      });

      console.log("[MMD_PROOF] STEP verify_order_code RESULT", {
        rpcError: error?.message ?? null,
        success: (data as any)?.success,
        rpcMessage: (data as any)?.message,
      });

      if (error) {
        console.error("Erreur RPC verify_order_code:", error);
        Alert.alert(
          t("common.error", "Erreur"),
          error.message ??
            t(
              "driver.orderDetails.codeServerError",
              "Erreur serveur pendant la vérification du code."
            )
        );
        return;
      }

      const success = (data as any)?.success === true;
      const message =
        (data as any)?.message ??
        (kind === "pickup"
          ? t("driver.orderDetails.codePickupOk", "Code de retrait validé ✅")
          : t("driver.orderDetails.codeDropoffOk", "Code de livraison validé ✅"));

      if (!success) {
        console.log("verify_order_code mobile data", data);
        Alert.alert(
          t("driver.orderDetails.codeInvalidTitle", "Code invalide"),
          message
        );
        return;
      }

      await callConfirmRoute(kind, order.id, uploaded.publicUrl);
      await fetchOrder();
      closeCodeModal();

      Alert.alert(t("common.success", "Succès"), message);
    } catch (e: any) {
      console.error("[MMD_PROOF] handleSubmitCode CATCH", {
        message: e?.message,
        name: e?.name,
        stack: e?.stack,
      });
      console.error("Erreur handleSubmitCode:", e);
      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ??
          t(
            "driver.orderDetails.codeVerifyError",
            "Impossible de vérifier le code pour le moment."
          )
      );
    } finally {
      setSubmittingCode(false);
    }
  }


  const communicationDisabled =
    !order ||
    !!calling ||
    loading ||
    accepting ||
    canceling ||
    submittingCode ||
    proofUploading ||
    proofPhotoPreparing ||
    !!verifyingKind ||
    isFinalStatus(order.status) ||
    !isAssignedDriver;

  const startOrderCall = useCallback(
    async (targetRole: CommunicationTarget) => {
      if (!order?.id || communicationDisabled) return;

      if (isFinalStatus(order.status)) {
        Alert.alert(
          t("common.error", "Erreur"),
          t(
            "driver.orderDetails.communication.callClosed",
            "Les appels sont désactivés pour cette commande."
          )
        );
        return;
      }

      if (targetRole === "restaurant" && isPickupDropoff) {
        Alert.alert(
          t("common.error", "Erreur"),
          t(
            "driver.orderDetails.communication.noRestaurant",
            "Cette course pickup/dropoff n’a pas de restaurant à appeler."
          )
        );
        return;
      }

      setCalling(targetRole);

      try {
        await startMaskedCall({
          orderId: order.id,
          callerRole: "driver",
          targetRole,
          sourceTable: getOrderSourceTable(order),
        });
      } catch (e: any) {
        const rawMessage = String(e?.message ?? e ?? "").toLowerCase();

        console.log("startMaskedCall driver error:", {
          orderId: order.id,
          callerRole: "driver",
          targetRole,
          message: e?.message ?? e,
        });

        if (rawMessage.includes("caller phone not found")) {
          Alert.alert(
            t("driver.orderDetails.communication.callUnavailableTitle", "Call unavailable"),
            t(
              "driver.orderDetails.communication.driverPhoneMissing",
              "Ton numéro de téléphone chauffeur est manquant. Ajoute ton numéro dans ton profil avant d'utiliser les appels masqués."
            )
          );
          return;
        }

        if (
          rawMessage.includes("target phone not found") ||
          rawMessage.includes("phone not found") ||
          rawMessage.includes("missing phone")
        ) {
          const targetLabel =
            targetRole === "client"
              ? t("driver.orderDetails.communication.client", "Client")
              : targetRole === "restaurant"
              ? t("driver.orderDetails.communication.restaurant", "Restaurant")
              : t("driver.orderDetails.communication.support", "MMD support");

          Alert.alert(
            t("driver.orderDetails.communication.callUnavailableTitle", "Call unavailable"),
            t(
              "driver.orderDetails.communication.targetPhoneMissing",
              "Le numéro de téléphone de {{target}} est manquant pour cette commande.",
              { target: targetLabel }
            )
          );
          return;
        }

        Alert.alert(
          t("driver.orderDetails.communication.callUnavailableTitle", "Call unavailable"),
          e?.message ??
            t(
              "driver.orderDetails.communication.callFailed",
              "Impossible de démarrer l'appel pour le moment."
            )
        );
      } finally {
        setCalling(null);
      }
    },
    [communicationDisabled, isPickupDropoff, order?.id, order?.status, t]
  );

  const callClient = useCallback(() => {
    void startOrderCall("client");
  }, [startOrderCall]);

  const callRestaurant = useCallback(() => {
    void startOrderCall("restaurant");
  }, [startOrderCall]);

  const callAdmin = useCallback(() => {
    void startOrderCall("admin");
  }, [startOrderCall]);

  function openOrderChat(targetRole: CommunicationTarget) {
    if (!order?.id || !isAssignedDriver) return;

    if (isFinalStatus(order.status)) {
      Alert.alert(
        t("common.error", "Erreur"),
        t(
          "driver.orderDetails.communication.chatClosed",
          "Les messages sont désactivés pour cette commande."
        )
      );
      return;
    }

    if (targetRole === "restaurant" && isPickupDropoff) {
      Alert.alert(
        t("common.error", "Erreur"),
        t(
          "driver.orderDetails.communication.noRestaurantMessage",
          "Cette course pickup/dropoff n’a pas de restaurant à contacter."
        )
      );
      return;
    }

    try {
      (navigation as any).navigate("DriverChat", { orderId: order.id, targetRole, sourceTable: getOrderSourceTable(order) });
      return;
    } catch {}

    try {
      (navigation as any).navigate("OrderChat", { orderId: order.id, targetRole, sourceTable: getOrderSourceTable(order) });
    } catch (e) {
      console.error("Navigation chat introuvable:", e);
      Alert.alert(
        t("driver.orderDetails.chatTitle", "Chat"),
        t(
          "driver.orderDetails.chatRouteMissing",
          "Route de chat introuvable. Vérifie AppNavigator (DriverChat / OrderChat)."
        )
      );
    }
  }

  const messageClient = useCallback(() => {
    openOrderChat("client");
  }, [order?.id, order?.status, isPickupDropoff]);

  const messageRestaurant = useCallback(() => {
    openOrderChat("restaurant");
  }, [order?.id, order?.status, isPickupDropoff]);

  const messageAdmin = useCallback(() => {
    openOrderChat("admin");
  }, [order?.id, order?.status, isPickupDropoff]);

  function openDriverChat() {
    try {
      (navigation as any).navigate("DriverChat", { orderId, targetRole: "admin", sourceTable });
      return;
    } catch {}
    try {
      (navigation as any).navigate("OrderChat", { orderId, targetRole: "admin", sourceTable });
    } catch (e) {
      console.error("Navigation chat introuvable:", e);
      Alert.alert(
        t("driver.orderDetails.chatTitle", "Chat"),
        t(
          "driver.orderDetails.chatRouteMissing",
          "Route de chat introuvable. Vérifie AppNavigator (DriverChat / OrderChat)."
        )
      );
    }
  }

  if (loading && !order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 8, color: "#9CA3AF" }}>
            {t("shared.common.loading", "Chargement…")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <StatusBar barStyle="light-content" />
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: "#F9FAFB", fontSize: 16, marginBottom: 12 }}>
            {t("driver.orderDetails.notFoundShort", "Course introuvable.")}
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: "#4B5563",
              paddingHorizontal: 20,
              paddingVertical: 10,
            }}
          >
            <Text style={{ color: "#E5E7EB" }}>{t("common.back", "← Retour")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const badge = statusBadgeStyle(order.status);

  const clientId = order.client_user_id ?? order.client_id ?? null;
  const clientName = clientId
    ? getProfileDisplayName(
        clientProfile,
        t("driver.orderDetails.communication.client", "Client"),
        clientId
      )
    : t("driver.orderDetails.communication.client", "Client");

  const restaurantName = getRestaurantDisplayName(
    restaurantProfile,
    order.restaurant_name
  );

  const clientAvatarUrl = resolveAvatarUrl(clientProfile?.avatar_url);
  const restaurantAvatarUrl =
    resolveAvatarUrl(restaurantProfile?.avatar_url) ||
    resolveAvatarUrl(restaurantProfile?.logo_url);

  const ProfileHeader = ({
    title,
    name,
    subtitle,
    avatarUrl,
    fallbackEmoji,
    loadingProfile,
  }: {
    title: string;
    name: string;
    subtitle: string;
    avatarUrl: string | null;
    fallbackEmoji: string;
    loadingProfile?: boolean;
  }) => (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 12,
      }}
    >
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.22)",
            backgroundColor: "#0B1220",
          }}
        />
      ) : (
        <View
          style={{
            width: 54,
            height: 54,
            borderRadius: 27,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.22)",
            backgroundColor: "#0B1220",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 20 }}>{fallbackEmoji}</Text>
          <Text style={{ color: "#E5E7EB", fontSize: 10, fontWeight: "900" }}>
            {initials(name)}
          </Text>
        </View>
      )}

      <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: "#93C5FD", fontSize: 11, fontWeight: "900", textTransform: "uppercase" }}
        >
          {title}
        </Text>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ color: "#E5E7EB", fontSize: 16, fontWeight: "900", marginTop: 2 }}
        >
          {name}
        </Text>
        <Text
          numberOfLines={2}
          ellipsizeMode="tail"
          style={{ color: "#9CA3AF", fontSize: 12, marginTop: 3 }}
        >
          {loadingProfile ? t("driver.orderDetails.profile.loading", "Chargement du profil…") : subtitle}
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ height: 265, width: "100%" }}>
        <Mapbox.MapView style={{ flex: 1 }} styleURL={getMapStyleStreets()}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled
          surfaceView={false}>
          <Mapbox.Camera
            ref={cameraRef}
            centerCoordinate={tripCamera.centerCoordinate}
            zoomLevel={tripCamera.zoomLevel}
            animationMode="flyTo"
            animationDuration={650}
            allowUpdates
          />

          {pickupCoord && (
            <Mapbox.PointAnnotation
              id={`pickup-${order.id}`}
              coordinate={coordinateToMapbox(pickupCoord)}
            >
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "#1D4ED8",
                  borderWidth: 2,
                  borderColor: "#FFFFFF",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "900" }}>
                  {isPickupDropoff
                    ? t("driver.orderDetails.map.pickupGeneric", "Pickup")
                    : t("driver.orderDetails.map.pickupTitle", "Restaurant")}
                </Text>
              </View>
            </Mapbox.PointAnnotation>
          )}

          {dropoffCoord && (
            <Mapbox.PointAnnotation
              id={`dropoff-${order.id}`}
              coordinate={coordinateToMapbox(dropoffCoord)}
            >
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "#16A34A",
                  borderWidth: 2,
                  borderColor: "#FFFFFF",
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "900" }}>
                  {isPickupDropoff
                    ? t("driver.orderDetails.map.dropoffGeneric", "Dropoff")
                    : t("driver.orderDetails.map.dropoffTitle", "Client")}
                </Text>
              </View>
            </Mapbox.PointAnnotation>
          )}

          {polylineCoords.length === 2 && (
            <Mapbox.ShapeSource id={`trip-line-${order.id}`} shape={tripLineFeature}>
              <Mapbox.LineLayer
                id={`trip-line-layer-${order.id}`}
                style={{
                  lineColor: "#60A5FA",
                  lineWidth: 4,
                  lineOpacity: 0.95,
                }}
              />
            </Mapbox.ShapeSource>
          )}
        </Mapbox.MapView>
        <View style={{ position: "absolute", top: 10, right: 10 }}>
          <TouchableOpacity
            onPress={() => {
              if (!pickupCoord && !dropoffCoord) {
                Alert.alert(
                  t("driver.orderDetails.missingCoordsTitle", "Infos manquantes"),
                  t(
                    "driver.orderDetails.missingCoordsBody",
                    "Cette course n’a pas encore de coordonnées GPS."
                  )
                );
                return;
              }
              fitMapToTrip();
            }}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 999,
              backgroundColor: "rgba(2,6,23,0.85)",
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "#93C5FD", fontWeight: "700", fontSize: 12 }}>
              {t("driver.orderDetails.rezoom", "Re-zoom")}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ marginTop: 12, marginBottom: 8 }}
        >
          <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
            {t("common.back", "← Retour")}
          </Text>
        </TouchableOpacity>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <View style={{ flex: 1, paddingRight: 10 }}>
            <Text style={{ color: "white", fontSize: 22, fontWeight: "800", marginBottom: 4 }}>
              {isPickupDropoff
                ? t("driver.orderDetails.header.tripTitle", "Trip #{{id}}", {
                    id: order.id.slice(0, 8),
                  })
                : t("driver.orderDetails.header.title", "Course #{{id}}", {
                    id: order.id.slice(0, 8),
                  })}
            </Text>
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {t("driver.orderDetails.header.createdAt", "Créée le : {{date}}", {
                date: formatDate(order.created_at),
              })}
            </Text>
          </View>

          <View
            style={{
              alignSelf: "flex-start",
              borderRadius: 999,
              borderWidth: 1,
              borderColor: badge.border,
              backgroundColor: badge.bg,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: badge.text, fontSize: 12, fontWeight: "700" }}>
              {formatStatusLabel(order)}
            </Text>
          </View>
        </View>

        <View
          style={{
            marginTop: 14,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.14)",
            backgroundColor: "rgba(15,23,42,0.78)",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
            {isPickupDropoff
              ? t("driver.orderDetails.steps.stops", "Stops")
              : t("driver.orderDetails.steps.title", "Étapes")}
          </Text>

          {!!order.restaurant_name && !isPickupDropoff && (
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 8 }}>
              {t("driver.orderDetails.steps.restaurant", "Restaurant : ")}
              <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                {order.restaurant_name}
              </Text>
            </Text>
          )}

          <View style={{ marginBottom: 10 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {isPickupDropoff
                ? t("driver.orderDetails.steps.pickupPoint", "Pickup ")
                : t("driver.orderDetails.steps.pickup", "Retrait ")}
              <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                {order.pickup_address ?? "—"}
              </Text>
            </Text>
          </View>

          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {isPickupDropoff
                ? t("driver.orderDetails.steps.dropoffPoint", "Dropoff ")
                : t("driver.orderDetails.steps.dropoff", "Livraison ")}
              <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                {order.dropoff_address ?? "—"}
              </Text>
            </Text>
          </View>

          {isDeliveryRequest && order.dropoff_location_id ? (
            <DriverTripLocationCard
              locationId={order.dropoff_location_id}
              title={t(
                "driver.orderDetails.dropoffLocationDetails",
                "Client dropoff location details"
              )}
              onViewOnMap={() => openMmdNavigation()}
            />
          ) : null}

          {isAssignedDriver && !isFinalStatus(order.status) && (
            <TouchableOpacity
              onPress={openMmdNavigation}
              activeOpacity={0.9}
              style={{
                marginBottom: 12,
                borderRadius: 999,
                paddingVertical: 14,
                alignItems: "center",
                backgroundColor: "#7C3AED",
                borderWidth: 1,
                borderColor: "rgba(196,181,253,0.65)",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "900" }}>
                {t("driver.orderDetails.actions.mmdNavigation", "Navigation MMD")}
              </Text>
              <Text style={{ color: "#DDD6FE", fontSize: 11, fontWeight: "700", marginTop: 2 }}>
                {canDeliver
                  ? t("driver.orderDetails.actions.mmdNavigationDropoff", "Route vers le client")
                  : t("driver.orderDetails.actions.mmdNavigationPickup", "Route vers le pickup")}
              </Text>
            </TouchableOpacity>
          )}

          <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "800", marginBottom: 8 }}>
            {t("driver.orderDetails.actions.backupNavigation", "Options de secours")}
          </Text>

          <View style={{ flexDirection: "row", marginBottom: 8 }}>
            <TouchableOpacity
              onPress={openMapsPickup}
              activeOpacity={0.86}
              style={{
                flex: 1,
                marginRight: 8,
                borderRadius: 999,
                paddingVertical: 10,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "#1D4ED8",
              }}
            >
              <Text style={{ color: "#BFDBFE", fontSize: 12, fontWeight: "800" }}>
                {t("driver.orderDetails.actions.googlePickup", "Google / Apple pickup")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openMapsDropoff}
              activeOpacity={0.86}
              style={{
                flex: 1,
                borderRadius: 999,
                paddingVertical: 10,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "#16A34A",
              }}
            >
              <Text style={{ color: "#BBF7D0", fontSize: 12, fontWeight: "800" }}>
                {t("driver.orderDetails.actions.googleDropoff", "Google / Apple dropoff")}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ flexDirection: "row" }}>
            <TouchableOpacity
              onPress={openWazePickup}
              activeOpacity={0.86}
              style={{
                flex: 1,
                marginRight: 8,
                borderRadius: 999,
                paddingVertical: 10,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "#38BDF8",
              }}
            >
              <Text style={{ color: "#BAE6FD", fontSize: 12, fontWeight: "800" }}>
                {t("driver.orderDetails.actions.wazePickup", "Waze pickup")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openWazeDropoff}
              activeOpacity={0.86}
              style={{
                flex: 1,
                borderRadius: 999,
                paddingVertical: 10,
                alignItems: "center",
                borderWidth: 1,
                borderColor: "#38BDF8",
              }}
            >
              <Text style={{ color: "#BAE6FD", fontSize: 12, fontWeight: "800" }}>
                {t("driver.orderDetails.actions.wazeDropoff", "Waze dropoff")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.14)",
            backgroundColor: "rgba(15,23,42,0.78)",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
            {isPickupDropoff
              ? t("driver.orderDetails.summary.transportTitle", "Summary")
              : t("driver.orderDetails.summary.title", "Résumé transport")}
          </Text>

          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {t("driver.orderDetails.summary.distance", "Distance")}
            </Text>
            <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "700" }}>
              {formatMiles(order.distance_miles)}
            </Text>
          </View>

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 6,
            }}
          >
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {t("driver.orderDetails.summary.eta", "Temps estimé")}
            </Text>
            <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "700" }}>
              {formatMinutes(order.eta_minutes)}
            </Text>
          </View>

        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.14)",
            backgroundColor: "rgba(15,23,42,0.78)",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
            {isPickupDropoff
              ? t("driver.orderDetails.earnings.estimateTitle", "Earnings (estimate)")
              : t("driver.orderDetails.earnings.title", "Rémunération (transport)")}
          </Text>

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {t("driver.orderDetails.earnings.yourPart", "Ta part")}
            </Text>
            <Text style={{ color: "#22C55E", fontSize: 16, fontWeight: "900" }}>
              {formatMoneyUSD(driverPart)}
            </Text>
          </View>

          <Text style={{ marginTop: 6, color: "#6B7280", fontSize: 11 }}>
            {t(
              "driver.orderDetails.earnings.note",
              "Montant estimé basé uniquement sur le transport MMD Delivery."
            )}
          </Text>
        </View>

        {canCancelAsDriver && (
          <View
            style={{
              marginTop: 12,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(248,113,113,0.35)",
              backgroundColor: "rgba(127,29,29,0.14)",
              padding: 14,
            }}
          >
            <Text style={{ color: "#FECACA", fontSize: 15, fontWeight: "900", marginBottom: 8 }}>
              {t("driver.orderDetails.cancel.cardTitle", "Besoin d’annuler ?")}
            </Text>
            <Text style={{ color: "#FCA5A5", fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
              {t(
                "driver.orderDetails.cancel.cardBody",
                "Tu peux annuler avant le pickup. La course sera remise disponible pour un autre chauffeur."
              )}
            </Text>
            <TouchableOpacity
              onPress={handleCancelAsDriver}
              disabled={canceling}
              style={{
                borderRadius: 999,
                paddingVertical: 12,
                alignItems: "center",
                backgroundColor: canceling ? "rgba(148,163,184,0.25)" : "rgba(248,113,113,0.95)",
                borderWidth: 1,
                borderColor: canceling ? "rgba(148,163,184,0.20)" : "rgba(248,113,113,0.55)",
              }}
            >
              {canceling ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ color: "white", fontSize: 13, fontWeight: "900" }}>
                  {t("driver.orderDetails.cancel.button", "Annuler cette course")}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.14)",
            backgroundColor: "rgba(15,23,42,0.78)",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 10 }}>
            {t("driver.orderDetails.verify.title", "Vérification")}
          </Text>

          <TouchableOpacity
            disabled={!canPickup}
            onPress={() => openCodeModal("pickup")}
            style={{
              borderRadius: 999,
              paddingVertical: 12,
              alignItems: "center",
              marginBottom: 10,
              backgroundColor: canPickup ? "#1D4ED8" : "#111827",
              opacity: canPickup ? 1 : 0.55,
              borderWidth: 1,
              borderColor: canPickup ? "#60A5FA" : "#374151",
            }}
          >
            <Text
              style={{
                color: canPickup ? "white" : "#6B7280",
                fontSize: 13,
                fontWeight: "800",
              }}
            >
              {isPickupDropoff
                ? t("driver.orderDetails.verify.pickupBtnPd", "Verify pickup (code + photo)")
                : t("driver.orderDetails.verify.pickupBtn", "Valider retrait (code + photo)")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            disabled={!canDeliver}
            onPress={() => openCodeModal("dropoff")}
            style={{
              borderRadius: 999,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: canDeliver ? "#16A34A" : "#111827",
              opacity: canDeliver ? 1 : 0.55,
              borderWidth: 1,
              borderColor: canDeliver ? "#34D399" : "#374151",
            }}
          >
            <Text
              style={{
                color: canDeliver ? "white" : "#6B7280",
                fontSize: 13,
                fontWeight: "800",
              }}
            >
              {isPickupDropoff
                ? t("driver.orderDetails.verify.dropoffBtnPd", "Verify dropoff (code + photo)")
                : t("driver.orderDetails.verify.dropoffBtn", "Valider livraison (code + photo)")}
            </Text>
          </TouchableOpacity>

          <Text style={{ marginTop: 10, color: "#6B7280", fontSize: 11 }}>
            {isPickupDropoff
              ? t(
                  "driver.orderDetails.verify.autoHintPd",
                  "Pour les courses pickup/dropoff, le code et la photo sont obligatoires au pickup et au dropoff."
                )
              : t(
                  "driver.orderDetails.verify.autoHint",
                  "Les boutons s’activent automatiquement au bon moment selon le statut."
                )}
          </Text>
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 22,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.14)",
            backgroundColor: "rgba(15,23,42,0.78)",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
            {t("driver.orderDetails.communication.title", "Communication")}
          </Text>

          <Text style={{ color: "#9CA3AF", fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
            {t(
              "driver.orderDetails.communication.hint",
              "Appelle ou envoie un message au client, au restaurant ou au support MMD sans exposer ton vrai numéro."
            )}
          </Text>

          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(148,163,184,0.14)",
              backgroundColor: "rgba(2,6,23,0.35)",
              padding: 12,
              marginBottom: 10,
            }}
          >
            <ProfileHeader
              title={t("driver.orderDetails.communication.client", "Client")}
              name={clientName}
              subtitle={t(
                "driver.orderDetails.communication.clientProfile",
                "Profil client lié à cette course"
              )}
              avatarUrl={clientAvatarUrl}
              fallbackEmoji="👤"
              loadingProfile={clientProfileLoading}
            />

            <View style={{ flexDirection: "row" }}>
              <TouchableOpacity
                disabled={communicationDisabled}
                onPress={callClient}
                style={{
                  flex: 1,
                  marginRight: 8,
                  borderRadius: 999,
                  paddingVertical: 11,
                  alignItems: "center",
                  backgroundColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(37,99,235,0.95)",
                  borderWidth: 1,
                  borderColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(59,130,246,0.35)",
                }}
              >
                {calling === "client" ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={{ color: "white", fontSize: 12, fontWeight: "900" }}>
                    📞 {t("driver.orderDetails.communication.call", "Call")}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                disabled={communicationDisabled}
                onPress={messageClient}
                style={{
                  flex: 1,
                  borderRadius: 999,
                  paddingVertical: 11,
                  alignItems: "center",
                  backgroundColor: "rgba(15,23,42,0.95)",
                  opacity: communicationDisabled ? 0.5 : 1,
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.20)",
                }}
              >
                <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "900" }}>
                  💬 {t("driver.orderDetails.communication.message", "Message")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {!isPickupDropoff && (
            <View
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "rgba(148,163,184,0.14)",
                backgroundColor: "rgba(2,6,23,0.35)",
                padding: 12,
                marginBottom: 10,
              }}
            >
              <ProfileHeader
                title={t("driver.orderDetails.communication.restaurant", "Restaurant")}
                name={restaurantName}
                subtitle={t(
                  "driver.orderDetails.communication.restaurantProfile",
                  "Profil restaurant lié à cette commande"
                )}
                avatarUrl={restaurantAvatarUrl}
                fallbackEmoji="🍽️"
                loadingProfile={restaurantProfileLoading}
              />

              <View style={{ flexDirection: "row" }}>
                <TouchableOpacity
                  disabled={communicationDisabled}
                  onPress={callRestaurant}
                  style={{
                    flex: 1,
                    marginRight: 8,
                    borderRadius: 999,
                    paddingVertical: 11,
                    alignItems: "center",
                    backgroundColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(14,165,233,0.95)",
                    borderWidth: 1,
                    borderColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(14,165,233,0.35)",
                  }}
                >
                  {calling === "restaurant" ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: "white", fontSize: 12, fontWeight: "900" }}>
                      📞 {t("driver.orderDetails.communication.call", "Call")}
                    </Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={communicationDisabled}
                  onPress={messageRestaurant}
                  style={{
                    flex: 1,
                    borderRadius: 999,
                    paddingVertical: 11,
                    alignItems: "center",
                    backgroundColor: "rgba(15,23,42,0.95)",
                    opacity: communicationDisabled ? 0.5 : 1,
                    borderWidth: 1,
                    borderColor: "rgba(148,163,184,0.20)",
                  }}
                >
                  <Text style={{ color: "#93C5FD", fontSize: 12, fontWeight: "900" }}>
                    💬 {t("driver.orderDetails.communication.message", "Message")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          <View
            style={{
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "rgba(124,58,237,0.25)",
              backgroundColor: "rgba(124,58,237,0.08)",
              padding: 12,
            }}
          >
            <Text style={{ color: "#EDE9FE", fontWeight: "900", marginBottom: 10 }}>
              🛟 {t("driver.orderDetails.communication.support", "MMD support")}
            </Text>

            <View style={{ flexDirection: "row" }}>
              <TouchableOpacity
                disabled={communicationDisabled}
                onPress={callAdmin}
                style={{
                  flex: 1,
                  marginRight: 8,
                  borderRadius: 999,
                  paddingVertical: 11,
                  alignItems: "center",
                  backgroundColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(124,58,237,0.95)",
                  borderWidth: 1,
                  borderColor: communicationDisabled ? "rgba(148,163,184,0.18)" : "rgba(124,58,237,0.35)",
                }}
              >
                {calling === "admin" ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={{ color: "white", fontSize: 12, fontWeight: "900" }}>
                    📞 {t("driver.orderDetails.communication.call", "Call")}
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                disabled={communicationDisabled}
                onPress={messageAdmin}
                style={{
                  flex: 1,
                  borderRadius: 999,
                  paddingVertical: 11,
                  alignItems: "center",
                  backgroundColor: "rgba(15,23,42,0.95)",
                  opacity: communicationDisabled ? 0.5 : 1,
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.20)",
                }}
              >
                <Text style={{ color: "#C4B5FD", fontSize: 12, fontWeight: "900" }}>
                  💬 {t("driver.orderDetails.communication.message", "Message")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <TouchableOpacity
          onPress={openDriverChat}
          activeOpacity={0.9}
          style={{
            marginTop: 14,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "#1F2937",
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: "rgba(139,92,246,0.16)",
          }}
        >
          <Text style={{ color: "#C4B5FD", fontSize: 13, fontWeight: "900" }}>
            {t("driver.orderDetails.chat.open", "Ouvrir le chat 💬")}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {canAccept && (
        <View
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 16,
            borderRadius: 18,
            padding: 12,
            backgroundColor: "rgba(2,6,23,0.985)",
            borderWidth: 1,
            borderColor: "rgba(34,197,94,0.35)",
          }}
        >
          <TouchableOpacity
            onPress={handleAccept}
            disabled={accepting}
            activeOpacity={0.9}
            style={{
              borderRadius: 999,
              paddingVertical: 12,
              alignItems: "center",
              backgroundColor: "#16A34A",
              opacity: accepting ? 0.7 : 1,
            }}
          >
            <Text style={{ color: "white", fontSize: 14, fontWeight: "900" }}>
              {accepting
                ? t("driver.orderDetails.accept.loading", "Acceptation...")
                : t("driver.orderDetails.accept.cta", "Accepter la course")}
            </Text>
          </TouchableOpacity>

          <Text
            style={{
              marginTop: 8,
              color: "#9CA3AF",
              fontSize: 11,
              textAlign: "center",
            }}
          >
            {t(
              "driver.orderDetails.accept.hint",
              "En acceptant, tu seras assigné à cette course."
            )}
          </Text>
        </View>
      )}

      <Modal
        transparent
        visible={verifyingKind !== null}
        animationType="fade"
        onRequestClose={closeCodeModal}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.6)",
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: 24,
          }}
        >
          <View
            style={{
              width: "100%",
              borderRadius: 24,
              backgroundColor: "rgba(2,6,23,0.98)",
              borderWidth: 1,
              borderColor: "rgba(167,139,250,0.22)",
              padding: 16,
            }}
          >
            <Text style={{ color: "#F9FAFB", fontSize: 16, fontWeight: "900", marginBottom: 8 }}>
              {verifyingKind === "pickup"
                ? isPickupDropoff
                  ? t("driver.orderDetails.modal.pickupTitlePd", "Pickup verification")
                  : t("driver.orderDetails.modal.pickupTitle", "Code de retrait")
                : isPickupDropoff
                ? t("driver.orderDetails.modal.dropoffTitlePd", "Dropoff verification")
                : t("driver.orderDetails.modal.dropoffTitle", "Code de livraison")}
            </Text>

            <Text style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 10 }}>
              {isPickupDropoff
                ? verifyingKind === "pickup"
                  ? t(
                      "driver.orderDetails.modal.hintPickupPd",
                      "Demande le code à la personne qui remet le colis, puis prends une photo de preuve."
                    )
                  : t(
                      "driver.orderDetails.modal.hintDropoffPd",
                      "Demande le code au destinataire, puis prends une photo de preuve de remise."
                    )
                : t(
                    "driver.orderDetails.modal.hint",
                    "Demande le code à la personne (restaurant ou client) et saisis-le."
                  )}
            </Text>

            <TextInput
              value={codeInput}
              onChangeText={(value) => setCodeInput(normalizeVerificationCode(value))}
              placeholder={t("driver.orderDetails.modal.placeholder", "Ex : ABC123")}
              placeholderTextColor="#6B7280"
              autoCapitalize="characters"
              style={{
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#4B5563",
                paddingHorizontal: 12,
                paddingVertical: 10,
                color: "#F9FAFB",
                marginBottom: 12,
              }}
            />

            <TouchableOpacity
              onPress={takeProofPhoto}
              disabled={submittingCode || proofUploading || proofPhotoPreparing}
              style={{
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#334155",
                backgroundColor: "#0F172A",
                paddingVertical: 12,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Text style={{ color: "#BFDBFE", fontSize: 13, fontWeight: "800" }}>
                {proofPhotoPreparing
                  ? t("driver.orderDetails.photo.preparing", "Préparation de la photo...")
                  : proofPhotoUri
                    ? t("driver.orderDetails.photo.retake", "Reprendre la photo")
                    : t("driver.orderDetails.photo.take", "Prendre la photo de preuve")}
              </Text>
            </TouchableOpacity>

            {proofPhotoUri ? (
              <View
                style={{
                  borderRadius: 14,
                  overflow: "hidden",
                  borderWidth: 1,
                  borderColor: "#1F2937",
                  marginBottom: 12,
                }}
              >
                <Image
                  source={{ uri: proofPhotoUri }}
                  style={{ width: "100%", height: 180, backgroundColor: "#111827" }}
                  resizeMode="cover"
                />
              </View>
            ) : null}

            <Text style={{ color: "#6B7280", fontSize: 11, marginBottom: 12 }}>
              {t(
                "driver.orderDetails.photo.requiredHint",
                "Le code et la photo sont obligatoires pour valider cette étape."
              )}
            </Text>

            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <TouchableOpacity
                onPress={closeCodeModal}
                disabled={submittingCode || proofUploading || proofPhotoPreparing}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#4B5563",
                  marginRight: 8,
                }}
              >
                <Text style={{ color: "#E5E7EB", fontSize: 13, fontWeight: "700" }}>
                  {t("common.cancel", "Annuler")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSubmitCode}
                disabled={submittingCode || proofUploading || proofPhotoPreparing}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                  backgroundColor: "#22C55E",
                  opacity: submittingCode || proofUploading || proofPhotoPreparing ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "white", fontSize: 13, fontWeight: "900" }}>
                  {submittingCode || proofUploading || proofPhotoPreparing
                    ? t("driver.orderDetails.modal.verifying", "Vérification...")
                    : t("driver.orderDetails.modal.submit", "Valider")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


export default DriverOrderDetailsScreen;
