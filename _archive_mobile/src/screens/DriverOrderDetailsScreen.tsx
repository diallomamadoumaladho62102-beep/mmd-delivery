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
} from "react-native";
import MapView, { Marker, Polyline, Region } from "react-native-maps";
import { useNavigation, useRoute, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";

import {
  startDriverLocationTracking,
  stopDriverLocationTracking,
} from "../lib/driverLocationTracker";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverOrderDetails">;
type DriverOrderDetailsRoute = RouteProp<RootStackParamList, "DriverOrderDetails">;

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type Order = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  delivery_fee: number | null;
  platform_delivery_fee: number | null;
  driver_delivery_payout: number | null;
  driver_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

type VerifyKind = "pickup" | "dropoff";

function formatMoneyUSD(v: number | null) {
  if (v == null) return "—";
  return `${v.toFixed(2)} USD`;
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
  const raw = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim().replace(/\/+$/, "");

  if (!raw) {
    throw new Error(
      "EXPO_PUBLIC_API_BASE_URL manquant. Exemple: http://192.168.1.45:3000"
    );
  }

  if (!/^https?:\/\//i.test(raw)) {
    throw new Error(
      "EXPO_PUBLIC_API_BASE_URL doit être une URL absolue. Exemple: http://192.168.1.45:3000"
    );
  }

  return raw;
}

export function DriverOrderDetailsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<DriverOrderDetailsRoute>();
  const { orderId } = route.params;

  const { t } = useTranslation();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [verifyingKind, setVerifyingKind] = useState<VerifyKind | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [submittingCode, setSubmittingCode] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const mapRef = useRef<MapView | null>(null);
  const didFitRef = useRef(false);

  const pickupCoord = useMemo(() => {
    if (order?.pickup_lat == null || order?.pickup_lng == null) return null;
    return { latitude: order.pickup_lat, longitude: order.pickup_lng };
  }, [order?.pickup_lat, order?.pickup_lng]);

  const dropoffCoord = useMemo(() => {
    if (order?.dropoff_lat == null || order?.dropoff_lng == null) return null;
    return { latitude: order.dropoff_lat, longitude: order.dropoff_lng };
  }, [order?.dropoff_lat, order?.dropoff_lng]);

  const polylineCoords = useMemo(() => {
    const coords: { latitude: number; longitude: number }[] = [];
    if (pickupCoord) coords.push(pickupCoord);
    if (dropoffCoord) coords.push(dropoffCoord);
    return coords;
  }, [pickupCoord, dropoffCoord]);

  const fallbackRegion: Region = useMemo(
    () => ({
      latitude: 40.650002,
      longitude: -73.949997,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    }),
    []
  );

  const fitMapToTrip = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (pickupCoord && dropoffCoord) {
      map.fitToCoordinates([pickupCoord, dropoffCoord], {
        edgePadding: { top: 60, right: 60, bottom: 60, left: 60 },
        animated: true,
      });
      return;
    }

    const only = pickupCoord ?? dropoffCoord;
    if (only) {
      map.animateToRegion(
        {
          latitude: only.latitude,
          longitude: only.longitude,
          latitudeDelta: 0.03,
          longitudeDelta: 0.03,
        },
        600
      );
    }
  }, [pickupCoord, dropoffCoord]);

  function formatStatusLabel(status: OrderStatus) {
    switch (status) {
      case "pending":
        return t("driver.orderDetails.status.pending", "En attente d’un chauffeur");
      case "accepted":
      case "prepared":
        return t("driver.orderDetails.status.accepted_prepared", "En attente (restaurant)");
      case "ready":
        return t("driver.orderDetails.status.ready", "Prête pour retrait");
      case "dispatched":
        return t("driver.orderDetails.status.dispatched", "En livraison");
      case "delivered":
        return t("driver.orderDetails.status.delivered", "Livrée");
      case "canceled":
        return t("driver.orderDetails.status.canceled", "Annulée");
      default:
        return status;
    }
  }

  function statusBadgeStyle(status: OrderStatus) {
    if (status === "delivered") {
      return { bg: "#064E3B", border: "#10B981", text: "#A7F3D0" };
    }
    if (status === "dispatched") {
      return { bg: "#422006", border: "#F59E0B", text: "#FDE68A" };
    }
    if (status === "ready") {
      return { bg: "#1E293B", border: "#60A5FA", text: "#BFDBFE" };
    }
    if (status === "canceled") {
      return { bg: "#7F1D1D", border: "#FCA5A5", text: "#FECACA" };
    }
    return { bg: "#111827", border: "#374151", text: "#E5E7EB" };
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!mounted) return;
        setMyUserId(data?.user?.id ?? null);
      })
      .catch(() => {
        if (!mounted) return;
        setMyUserId(null);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const fetchOrder = useCallback(async () => {
    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          id,
          status,
          created_at,
          restaurant_name,
          pickup_address,
          dropoff_address,
          distance_miles,
          eta_minutes,
          delivery_fee,
          platform_delivery_fee,
          driver_delivery_payout,
          driver_id,
          pickup_lat,
          pickup_lng,
          dropoff_lat,
          dropoff_lng
        `
        )
        .eq("id", orderId)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        Alert.alert(
          t("common.error", "Erreur"),
          t("driver.orderDetails.notFound", "Commande introuvable.")
        );
        navigation.goBack();
        return;
      }

      setOrder(data as Order);
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
  }, [orderId, navigation, t]);

  useEffect(() => {
    void fetchOrder();
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
    if (!order) return;
    if (!myUserId) return;

    const isMine = order.driver_id === myUserId;
    const inProgress =
      order.status === "accepted" ||
      order.status === "prepared" ||
      order.status === "ready" ||
      order.status === "dispatched";

    if (isMine && inProgress) {
      startDriverLocationTracking({ driverId: myUserId }).catch((e) => {
        console.log("startDriverLocationTracking error:", e?.message ?? e);
      });
    }

    const isEnded = order.status === "delivered" || order.status === "canceled";
    if (isMine && isEnded) {
      stopDriverLocationTracking();
    }
  }, [order?.status, order?.driver_id, myUserId]);

  function openMapsSingle(params: {
    address: string | null;
    lat: number | null;
    lng: number | null;
  }) {
    const { address, lat, lng } = params;

    if (typeof lat === "number" && typeof lng === "number") {
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

  const isAssignedDriver =
    !!order && !!myUserId && !!order.driver_id && order.driver_id === myUserId;

  const canPickup = !!order && order.status === "ready" && isAssignedDriver;
  const canDeliver = !!order && order.status === "dispatched" && isAssignedDriver;
  const canAccept = !!order && order.status === "pending" && !order.driver_id;

  function openCodeModal(kind: VerifyKind) {
    if (kind === "pickup" && !canPickup) return;
    if (kind === "dropoff" && !canDeliver) return;
    setCodeInput("");
    setVerifyingKind(kind);
  }

  function closeCodeModal() {
    setVerifyingKind(null);
    setCodeInput("");
    setSubmittingCode(false);
  }

  const transportFee = order?.delivery_fee ?? null;
  const driverPart =
    order?.driver_delivery_payout != null
      ? order.driver_delivery_payout
      : transportFee != null
      ? Math.round(transportFee * 0.8 * 100) / 100
      : null;

  async function callConfirmRoute(kind: VerifyKind, currentOrderId: string) {
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

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ order_id: currentOrderId }),
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
    if (!order) return;

    try {
      setAccepting(true);

      const { data: accepted, error: accErr } = await supabase.rpc("accept_order", {
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

  async function handleSubmitCode() {
    if (!order || !verifyingKind) return;

    if (!codeInput.trim()) {
      Alert.alert(
        t("driver.orderDetails.codeMissingTitle", "Code manquant"),
        t("driver.orderDetails.codeMissingBody", "Entre le code de vérification.")
      );
      return;
    }

    try {
      setSubmittingCode(true);

      const kind = verifyingKind;

      const { data, error } = await supabase.rpc("verify_order_code", {
        p_order_id: order.id,
        p_input_code: codeInput.trim(),
        p_code_type: kind,
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

      await callConfirmRoute(kind, order.id);
      await fetchOrder();
      closeCodeModal();

      Alert.alert(t("common.success", "Succès"), message);
    } catch (e: any) {
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

  function openDriverChat() {
    try {
      (navigation as any).navigate("DriverChat", { orderId });
      return;
    } catch {}
    try {
      (navigation as any).navigate("OrderChat", { orderId });
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ height: 240, width: "100%" }}>
        <MapView
          ref={(r) => {
            mapRef.current = r;
          }}
          style={{ flex: 1 }}
          initialRegion={fallbackRegion}
          onMapReady={() => {
            if ((pickupCoord || dropoffCoord) && !didFitRef.current) {
              fitMapToTrip();
              didFitRef.current = true;
            }
          }}
        >
          {pickupCoord && (
            <Marker
              coordinate={pickupCoord}
              title={t("driver.orderDetails.map.pickupTitle", "Restaurant")}
              description={order.pickup_address ?? undefined}
            />
          )}

          {dropoffCoord && (
            <Marker
              coordinate={dropoffCoord}
              title={t("driver.orderDetails.map.dropoffTitle", "Client")}
              description={order.dropoff_address ?? undefined}
            />
          )}

          {polylineCoords.length === 2 && (
            <Polyline coordinates={polylineCoords} strokeWidth={3} />
          )}
        </MapView>

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
              {t("driver.orderDetails.header.title", "Course #{{id}}", {
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
              {formatStatusLabel(order.status)}
            </Text>
          </View>
        </View>

        <View
          style={{
            marginTop: 14,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
            {t("driver.orderDetails.steps.title", "Étapes")}
          </Text>

          {order.restaurant_name && (
            <Text style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 8 }}>
              {t("driver.orderDetails.steps.restaurant", "Restaurant : ")}
              <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                {order.restaurant_name}
              </Text>
            </Text>
          )}

          <View style={{ marginBottom: 10 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {t("driver.orderDetails.steps.pickup", "Retrait ")}
              <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                {order.pickup_address ?? "—"}
              </Text>
            </Text>
          </View>

          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {t("driver.orderDetails.steps.dropoff", "Livraison ")}
              <Text style={{ color: "#E5E7EB", fontWeight: "600" }}>
                {order.dropoff_address ?? "—"}
              </Text>
            </Text>
          </View>

          <View style={{ flexDirection: "row" }}>
            <TouchableOpacity
              onPress={openMapsPickup}
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
                {t("driver.orderDetails.actions.goPickup", "Aller au retrait")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={openMapsDropoff}
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
                {t("driver.orderDetails.actions.goDropoff", "Aller à la livraison")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
            {t("driver.orderDetails.summary.title", "Résumé transport")}
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

          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 6,
            }}
          >
            <Text style={{ color: "#9CA3AF", fontSize: 12 }}>
              {t("driver.orderDetails.summary.transportFee", "Prix du transport")}
            </Text>
            <Text style={{ color: "#E5E7EB", fontSize: 12, fontWeight: "700" }}>
              {formatMoneyUSD(transportFee)}
            </Text>
          </View>
        </View>

        <View
          style={{
            marginTop: 12,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
            padding: 14,
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 15, fontWeight: "800", marginBottom: 8 }}>
            {t("driver.orderDetails.earnings.title", "Rémunération (transport)")}
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

        <View
          style={{
            marginTop: 12,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#111827",
            backgroundColor: "#020617",
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
              {t("driver.orderDetails.verify.pickupBtn", "Valider retrait (code)")}
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
              {t("driver.orderDetails.verify.dropoffBtn", "Valider livraison (code)")}
            </Text>
          </TouchableOpacity>

          <Text style={{ marginTop: 10, color: "#6B7280", fontSize: 11 }}>
            {t(
              "driver.orderDetails.verify.autoHint",
              "Les boutons s’activent automatiquement au bon moment selon le statut."
            )}
          </Text>
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
            backgroundColor: "rgba(15,23,42,0.7)",
          }}
        >
          <Text style={{ color: "#E5E7EB", fontSize: 13, fontWeight: "800" }}>
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
            backgroundColor: "rgba(15,23,42,0.98)",
            borderWidth: 1,
            borderColor: "#14532D",
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
              borderRadius: 16,
              backgroundColor: "#020617",
              borderWidth: 1,
              borderColor: "#111827",
              padding: 16,
            }}
          >
            <Text style={{ color: "#F9FAFB", fontSize: 16, fontWeight: "900", marginBottom: 8 }}>
              {verifyingKind === "pickup"
                ? t("driver.orderDetails.modal.pickupTitle", "Code de retrait")
                : t("driver.orderDetails.modal.dropoffTitle", "Code de livraison")}
            </Text>

            <Text style={{ color: "#9CA3AF", fontSize: 13, marginBottom: 10 }}>
              {t(
                "driver.orderDetails.modal.hint",
                "Demande le code à la personne (restaurant ou client) et saisis-le."
              )}
            </Text>

            <TextInput
              value={codeInput}
              onChangeText={setCodeInput}
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

            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <TouchableOpacity
                onPress={closeCodeModal}
                disabled={submittingCode}
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
                disabled={submittingCode}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 999,
                  backgroundColor: "#22C55E",
                  opacity: submittingCode ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "white", fontSize: 13, fontWeight: "900" }}>
                  {submittingCode
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