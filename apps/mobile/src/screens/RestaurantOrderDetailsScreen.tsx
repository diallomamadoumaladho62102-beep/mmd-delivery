// apps/mobile/src/screens/RestaurantOrderDetailsScreen.tsx
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
  StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "../lib/apiBase";
import { supabase } from "../lib/supabase";
import { startMaskedCall } from "../lib/maskedCall";

type OrderStatus =
  | "pending"
  | "accepted"
  | "prepared"
  | "ready"
  | "dispatched"
  | "delivered"
  | "canceled";

type OrderItem = {
  name: string;
  category?: string | null;
  quantity: number;
  unit_price: number;
  line_total?: number | null;
};

type Order = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  client_id: string | null;
  client_user_id?: string | null;
  restaurant_name: string | null;
  currency: string | null;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  restaurant_commission_rate: number | null;
  restaurant_commission_amount: number | null;
  restaurant_net_amount: number | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  eta_minutes: number | null;
  delivery_fee: number | null;
  pickup_code: string | null;
  driver_id: string | null;
  items_json: unknown;
};

type DriverProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

type CallingTarget = "client" | "driver" | "admin";

function getApiUrl(path: string) {
  const raw = String(API_BASE_URL || "").trim().replace(/\/+$/, "");

  if (!raw) throw new Error("API_BASE_URL manquant.");
  if (!/^https?:\/\//i.test(raw)) {
    throw new Error("API_BASE_URL doit être une URL absolue.");
  }

  return `${raw}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseItems(itemsJson: unknown): OrderItem[] {
  if (!itemsJson) return [];
  if (Array.isArray(itemsJson)) return itemsJson as OrderItem[];

  if (typeof itemsJson === "string") {
    try {
      const parsed = JSON.parse(itemsJson);
      return Array.isArray(parsed) ? (parsed as OrderItem[]) : [];
    } catch {
      return [];
    }
  }

  return [];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase() || "DR";
}

function canRestaurantCancel(status: OrderStatus) {
  return status === "pending" || status === "accepted" || status === "prepared";
}

function isFinalStatus(status: OrderStatus) {
  return status === "delivered" || status === "canceled";
}

export function RestaurantOrderDetailsScreen({ route, navigation }: any) {
  const { t, i18n } = useTranslation();
  const { orderId } = route.params as { orderId: string };

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [calling, setCalling] = useState<CallingTarget | null>(null);
  const [pickupCode, setPickupCode] = useState("");
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [driverLoading, setDriverLoading] = useState(false);

  const localeTag = useMemo(() => {
    const lng = String(i18n.language || "en").toLowerCase();
    if (lng.startsWith("fr")) return "fr-FR";
    if (lng.startsWith("es")) return "es-ES";
    if (lng.startsWith("ar")) return "ar";
    if (lng.startsWith("zh")) return "zh";
    if (lng.startsWith("ff")) return "ff";
    return "en-US";
  }, [i18n.language]);

  const selectFields = useMemo(
    () =>
      [
        "id",
        "status",
        "created_at",
        "client_id",
        "client_user_id",
        "restaurant_name",
        "currency",
        "subtotal",
        "tax",
        "total",
        "restaurant_commission_rate",
        "restaurant_commission_amount",
        "restaurant_net_amount",
        "pickup_address",
        "dropoff_address",
        "distance_miles",
        "eta_minutes",
        "delivery_fee",
        "pickup_code",
        "driver_id",
        "items_json",
      ].join(","),
    []
  );

  const fmtDateTime = useCallback(
    (iso?: string | null) => {
      if (!iso) return t("common.na", "—");
      return new Date(iso).toLocaleString(localeTag);
    },
    [localeTag, t]
  );

  const money = useCallback(
    (value: number | null | undefined, currency: string) => {
      if (value == null || Number.isNaN(value)) return t("common.na", "—");
      return `${Number(value).toFixed(2)} ${currency}`;
    },
    [t]
  );

  const restaurantStatusLabel = useCallback(
    (status: OrderStatus, driverId: string | null) => {
      if (status === "ready") {
        return driverId
          ? t("order.status.readyDriverAssigned", "Prête – chauffeur assigné")
          : t("order.status.readyWaitingDriver", "Prête – en attente d’un chauffeur");
      }

      switch (status) {
        case "pending":
          return t("order.status.pending", "En attente");
        case "accepted":
          return t("order.status.accepted", "Acceptée");
        case "prepared":
          return t("order.status.prepared", "En préparation");
        case "dispatched":
          return t("order.status.dispatched", "En livraison");
        case "delivered":
          return t("order.status.delivered", "Livrée");
        case "canceled":
          return t("order.status.canceled", "Annulée");
        default:
          return String(status);
      }
    },
    [t]
  );

  const fetchOrder = useCallback(async () => {
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from("orders")
        .select(selectFields)
        .eq("id", orderId)
        .maybeSingle();

      if (error || !data) {
        throw error ?? new Error(t("order.errors.notFound", "Commande introuvable."));
      }

      const nextOrder = data as unknown as Order;
      setOrder(nextOrder);
      setPickupCode(nextOrder.pickup_code ?? "");
    } catch (e: any) {
      Alert.alert(
        t("common.errorTitle", "Erreur"),
        e?.message ?? t("order.errors.load", "Impossible de charger la commande.")
      );
      setOrder(null);
    } finally {
      setLoading(false);
    }
  }, [orderId, selectFields, t]);

  const refetchOrderSilent = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select(selectFields)
      .eq("id", orderId)
      .maybeSingle();

    if (error || !data) {
      throw error ?? new Error(t("order.errors.notFound", "Commande introuvable."));
    }

    const nextOrder = data as unknown as Order;
    setOrder(nextOrder);
    setPickupCode(nextOrder.pickup_code ?? "");

    return nextOrder;
  }, [orderId, selectFields, t]);

  const fetchDriver = useCallback(async (driverId: string) => {
    setDriverLoading(true);

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", driverId)
        .maybeSingle();

      if (error) throw error;
      setDriver((data as unknown as DriverProfile) ?? null);
    } catch {
      setDriver(null);
    } finally {
      setDriverLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    const channel = supabase
      .channel(`restaurant-order:${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        () => {
          void refetchOrderSilent().catch(() => {});
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [orderId, refetchOrderSilent]);

  useEffect(() => {
    const driverId = order?.driver_id ?? null;

    if (!driverId) {
      setDriver(null);
      return;
    }

    void fetchDriver(driverId);
  }, [order?.driver_id, fetchDriver]);

  const startOrderCall = useCallback(
    async (targetRole: CallingTarget) => {
      if (!order?.id || calling || updating) return;

      if (isFinalStatus(order.status)) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t("order.call.finalOrder", "Les appels sont désactivés pour cette commande.")
        );
        return;
      }

      if (targetRole === "client" && !(order.client_id ?? order.client_user_id)) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t("order.call.clientMissing", "Client introuvable pour cette commande.")
        );
        return;
      }

      if (targetRole === "driver" && !order.driver_id) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t("order.call.driverMissing", "Aucun chauffeur n’est encore assigné à cette commande.")
        );
        return;
      }

      setCalling(targetRole);

      try {
        await startMaskedCall({
          orderId: order.id,
          callerRole: "restaurant",
          targetRole,
        });
      } finally {
        setCalling(null);
      }
    },
    [
      calling,
      order?.client_id,
      order?.client_user_id,
      order?.driver_id,
      order?.id,
      order?.status,
      t,
      updating,
    ]
  );

  const callClient = useCallback(() => {
    void startOrderCall("client");
  }, [startOrderCall]);

  const callDriver = useCallback(() => {
    void startOrderCall("driver");
  }, [startOrderCall]);

  const callAdmin = useCallback(() => {
    void startOrderCall("admin");
  }, [startOrderCall]);


  const openRestaurantChat = useCallback(
    (targetRole: CallingTarget) => {
      if (!order?.id || updating) return;

      if (isFinalStatus(order.status)) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t(
            "order.chat.finalOrder",
            "Les messages sont désactivés pour cette commande."
          )
        );
        return;
      }

      if (targetRole === "client" && !(order.client_id ?? order.client_user_id)) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t("order.chat.clientMissing", "Client introuvable pour cette commande.")
        );
        return;
      }

      if (targetRole === "driver" && !order.driver_id) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t(
            "order.chat.driverMissing",
            "Aucun chauffeur n’est encore assigné à cette commande."
          )
        );
        return;
      }

      navigation.navigate("RestaurantChat", {
        orderId: order.id,
        targetRole,
      });
    },
    [
      navigation,
      order?.client_id,
      order?.client_user_id,
      order?.driver_id,
      order?.id,
      order?.status,
      t,
      updating,
    ]
  );

  const messageClient = useCallback(() => {
    openRestaurantChat("client");
  }, [openRestaurantChat]);

  const messageDriver = useCallback(() => {
    openRestaurantChat("driver");
  }, [openRestaurantChat]);

  const messageAdmin = useCallback(() => {
    openRestaurantChat("admin");
  }, [openRestaurantChat]);

  const updateStatus = useCallback(
    async (next: OrderStatus) => {
      if (!order || updating) return;

      if (isFinalStatus(order.status)) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t("order.errors.finalStatus", "Cette commande est déjà terminée. Le statut ne peut plus changer.")
        );
        return;
      }

      const allowed =
        (order.status === "pending" && next === "accepted") ||
        (order.status === "accepted" && next === "prepared") ||
        (order.status === "prepared" && next === "ready");

      if (!allowed) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          t("order.errors.statusTransition", "Transition de statut non autorisée.")
        );
        return;
      }

      setUpdating(true);

      try {
        const { data, error } = await supabase
          .from("orders")
          .update({ status: next })
          .eq("id", order.id)
          .eq("status", order.status)
          .select(selectFields)
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          throw new Error(
            t("order.errors.statusChanged", "Le statut a changé. Recharge la commande puis réessaie.")
          );
        }

        const nextOrder = data as unknown as Order;
        setOrder(nextOrder);
        setPickupCode(nextOrder.pickup_code ?? "");
      } catch (e: any) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          e?.message ?? t("order.errors.update", "Impossible de mettre à jour le statut.")
        );
      } finally {
        setUpdating(false);
      }
    },
    [order, selectFields, t, updating]
  );

  const cancelOrderByRestaurant = useCallback(async () => {
    if (!order || updating) return;

    if (!canRestaurantCancel(order.status)) {
      Alert.alert(
        t("common.errorTitle", "Erreur"),
        t("order.errors.restaurantCancelNotAllowed", "Cette commande ne peut plus être annulée par le restaurant.")
      );
      return;
    }

    setUpdating(true);

    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(sessionError.message || "Session invalide.");
      }

      const token = sessionData.session?.access_token;

      if (!token) {
        throw new Error(
          t("auth.errors.sessionExpired", "Session expirée. Reconnecte-toi puis réessaie.")
        );
      }

      const response = await fetch(getApiUrl("/api/orders/cancel"), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId: order.id,
          role: "restaurant",
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.error ?? t("order.errors.cancel", "Impossible d’annuler cette commande.")
        );
      }

      await refetchOrderSilent();

      Alert.alert(
        t("common.successTitle", "Succès"),
        order.status === "pending"
          ? t("order.actions.rejectSuccess", "Commande refusée. Refund client requis selon la règle.")
          : t("order.actions.cancelSuccess", "Commande annulée. Refund client requis selon la règle.")
      );
    } catch (e: any) {
      Alert.alert(
        t("common.errorTitle", "Erreur"),
        e?.message ?? t("order.errors.cancel", "Impossible d’annuler cette commande.")
      );
    } finally {
      setUpdating(false);
    }
  }, [order, refetchOrderSilent, t, updating]);

  const confirmRestaurantCancel = useCallback(() => {
    if (!order || updating) return;

    const isReject = order.status === "pending";

    Alert.alert(
      isReject
        ? t("order.actions.rejectTitle", "Refuser la commande")
        : t("order.actions.cancelTitle", "Annuler la commande"),
      isReject
        ? t("order.actions.rejectConfirm", "Confirmer le refus de cette commande ? Le client devra être remboursé selon la règle.")
        : t("order.actions.cancelConfirm", "Confirmer l’annulation ? Le client devra être remboursé selon la règle."),
      [
        { text: t("common.cancel", "Non"), style: "cancel" },
        {
          text: isReject
            ? t("order.actions.reject", "Refuser")
            : t("order.actions.cancel", "Annuler"),
          style: "destructive",
          onPress: () => {
            void cancelOrderByRestaurant();
          },
        },
      ]
    );
  }, [cancelOrderByRestaurant, order, t, updating]);

  const currency = order?.currency ?? "USD";
  const items = useMemo(() => (order ? parseItems(order.items_json) : []), [order]);

  const itemsPlusTax = useMemo(() => {
    const subtotal = order?.subtotal ?? 0;
    const tax = order?.tax ?? 0;
    return subtotal + tax;
  }, [order?.subtotal, order?.tax]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>{t("common.loading", "Chargement…")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={styles.screen}>
        <StatusBar barStyle="light-content" />
        <View style={styles.emptyState}>
          <Text style={styles.textWhite}>
            {t("order.errors.notFound", "Commande introuvable.")}
          </Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.linkText}>{t("common.back", "← Retour")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canAccept = order.status === "pending";
  const canPrepare = order.status === "accepted";
  const canReady = order.status === "prepared";
  const canCancel = canRestaurantCancel(order.status);
  const callDisabled = !!calling || updating || isFinalStatus(order.status);

  const driverName =
    driver?.full_name?.trim() ||
    (order.driver_id
      ? t("order.driver.fallback", {
          defaultValue: "Chauffeur {{id}}",
          id: order.driver_id.slice(0, 8),
        })
      : null);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Text style={styles.linkText}>
              {t("order.details.backToOrders", "← Retour aux commandes")}
            </Text>
          </TouchableOpacity>

          <View style={styles.card}>
            <Text style={styles.title}>
              {t("order.details.title", {
                defaultValue: "Commande #{{id}}",
                id: order.id.slice(0, 8),
              })}
            </Text>

            <InfoLine
              label={t("order.details.statusLabel", "Statut")}
              value={restaurantStatusLabel(order.status, order.driver_id)}
            />

            <InfoLine
              label={t("order.details.createdAt", "Créée")}
              value={fmtDateTime(order.created_at)}
            />

            <InfoLine
              label={t("order.details.totalItemsTaxes", "Total (plats + taxes)")}
              value={money(itemsPlusTax, currency)}
              strong
            />

            <InfoLine
              label={t("order.details.netRestaurant", "Net restaurant")}
              value={money(order.restaurant_net_amount, currency)}
              success
            />
          </View>

          <View style={styles.actions}>
            {canAccept && (
              <ActionButton
                label={
                  updating
                    ? t("common.updating", "Mise à jour…")
                    : t("order.actions.accept", "Accepter la commande")
                }
                color="#EA580C"
                disabled={updating}
                onPress={() => updateStatus("accepted")}
              />
            )}

            {canPrepare && (
              <ActionButton
                label={
                  updating
                    ? t("common.updating", "Mise à jour…")
                    : t("order.actions.toPreparing", "Passer en préparation")
                }
                color="#F97316"
                disabled={updating}
                onPress={() => updateStatus("prepared")}
              />
            )}

            {canReady && (
              <ActionButton
                label={
                  updating
                    ? t("common.updating", "Mise à jour…")
                    : t("order.actions.ready", "Commande prête (READY)")
                }
                color="#16A34A"
                disabled={updating}
                onPress={() => updateStatus("ready")}
              />
            )}

            {canCancel && (
              <ActionButton
                label={
                  updating
                    ? t("common.updating", "Mise à jour…")
                    : order.status === "pending"
                      ? t("order.actions.reject", "Refuser la commande")
                      : t("order.actions.cancel", "Annuler la commande")
                }
                color="#DC2626"
                disabled={updating}
                onPress={confirmRestaurantCancel}
              />
            )}

            {!canAccept && !canPrepare && !canReady && !canCancel && (
              <View style={styles.notice}>
                <Text style={styles.mutedText}>
                  {t("order.actions.none", "Aucune action restaurant requise maintenant.")}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {t("order.details.supportSection", "Support")}
            </Text>
            <Text style={styles.paragraph}>
              {t(
                "order.details.supportHelp",
                "Besoin d’aide sur cette commande ? Appelle le support MMD sans partager ton vrai numéro."
              )}
            </Text>
            <ActionButton
              label={
                calling === "admin"
                  ? t("order.call.callingAdmin", "Appel support…")
                  : t("order.call.admin", "Call MMD support")
              }
              color="#7C3AED"
              disabled={callDisabled}
              onPress={callAdmin}
            />
            <ActionButton
              label={t("order.chat.admin", "Message MMD support")}
              color="#6D28D9"
              disabled={callDisabled}
              onPress={messageAdmin}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {t("order.details.restaurantSection", "Restaurant")}
            </Text>

            <Text style={styles.boldText}>
              {order.restaurant_name ?? t("common.na", "—")}
            </Text>

            <InfoLine
              label={t("order.details.pickupAddress", "Adresse de récupération")}
              value={order.pickup_address ?? t("common.na", "—")}
            />

            <Text style={styles.labelText}>
              {t("order.details.pickupCodeHelp", "Code pickup à donner au chauffeur :")}
            </Text>

            <TextInput
              value={pickupCode || t("common.na", "—")}
              editable={false}
              style={styles.pickupCodeInput}
            />

            <ActionButton
              label={
                calling === "client"
                  ? t("order.call.callingClient", "Appel client…")
                  : t("order.call.client", "Call client")
              }
              color="#2563EB"
              disabled={callDisabled}
              onPress={callClient}
            />
            <ActionButton
              label={t("order.chat.client", "Message client")}
              color="#1D4ED8"
              disabled={callDisabled}
              onPress={messageClient}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {t("order.details.driverSection", "Chauffeur")}
            </Text>

            {!order.driver_id ? (
              <Text style={styles.mutedText}>
                {t("order.driver.none", "Aucun chauffeur n’est encore assigné à cette commande.")}
              </Text>
            ) : (
              <>
                <View style={styles.driverRow}>
                  {driver?.avatar_url ? (
                    <Image source={{ uri: driver.avatar_url }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Text style={styles.avatarInitials}>
                        {initials(driverName ?? "Driver")}
                      </Text>
                    </View>
                  )}

                  <View style={styles.flex}>
                    <Text style={styles.driverName}>
                      {driverName ?? t("order.driver.title", "Chauffeur")}
                    </Text>
                    <Text style={styles.mutedText}>
                      {driverLoading
                        ? t("order.driver.loading", "Chargement du profil…")
                        : t("order.driver.profile", "Profil chauffeur")}
                    </Text>
                  </View>
                </View>

                <ActionButton
                  label={
                    calling === "driver"
                      ? t("order.call.callingDriver", "Appel chauffeur…")
                      : t("order.call.driver", "Call driver")
                  }
                  color="#0EA5E9"
                  disabled={callDisabled}
                  onPress={callDriver}
                />
                <ActionButton
                  label={t("order.chat.driver", "Message driver")}
                  color="#0284C7"
                  disabled={callDisabled}
                  onPress={messageDriver}
                />
              </>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {t("order.details.summary", "Récapitulatif de la commande")}
            </Text>

            {items.length === 0 ? (
              <Text style={styles.mutedText}>
                {t("order.details.noItems", "Aucun article.")}
              </Text>
            ) : (
              items.map((item, index) => {
                const line = item.line_total ?? item.unit_price * item.quantity;

                return (
                  <View
                    key={`${item.name}-${index}`}
                    style={[styles.itemRow, index > 0 && styles.itemBorder]}
                  >
                    <Text style={styles.boldText}>{item.name}</Text>

                    {item.category ? (
                      <Text style={styles.mutedText}>{item.category}</Text>
                    ) : null}

                    <Text style={styles.mutedText}>
                      {t("order.details.qty", {
                        defaultValue: "Qté {{q}}",
                        q: item.quantity,
                      })}{" "}
                      — {money(item.unit_price, currency)}
                      {t("order.details.perUnit", " / unité")}
                    </Text>

                    <Text style={styles.itemTotal}>
                      {t("order.details.line", "Ligne")} : {money(line, currency)}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>
              {t("order.details.totalsRestaurant", "Totaux (restaurant)")}
            </Text>

            <InfoLine
              label={t("order.details.subtotal", "Subtotal (plats)")}
              value={money(order.subtotal, currency)}
            />

            <InfoLine
              label={t("order.details.taxes", "Taxes")}
              value={money(order.tax, currency)}
            />

            <InfoLine
              label={t("order.details.itemsPlusTax", "Total plats + taxes")}
              value={money(itemsPlusTax, currency)}
              strong
            />

            <InfoLine
              label={t("order.details.commission", "Commission restaurant")}
              value={`${money(order.restaurant_commission_amount, currency)}${
                order.restaurant_commission_rate != null
                  ? ` (${(order.restaurant_commission_rate * 100).toFixed(0)}%)`
                  : ""
              }`}
              danger
            />

            <InfoLine
              label={t("order.details.netRestaurant", "Net restaurant")}
              value={money(order.restaurant_net_amount, currency)}
              success
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InfoLine({
  label,
  value,
  strong,
  success,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  success?: boolean;
  danger?: boolean;
}) {
  return (
    <Text style={styles.infoLine}>
      {label} :{" "}
      <Text
        style={[
          styles.infoValue,
          strong && styles.strongValue,
          success && styles.successValue,
          danger && styles.dangerValue,
        ]}
      >
        {value}
      </Text>
    </Text>
  );
}

function ActionButton({
  label,
  color,
  disabled,
  onPress,
}: {
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.actionButton,
        { backgroundColor: color },
        disabled && styles.disabledButton,
      ]}
    >
      <Text style={styles.actionButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  screen: {
    flex: 1,
    backgroundColor: "#111827",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: "white",
    marginTop: 8,
  },
  emptyState: {
    flex: 1,
    padding: 16,
  },
  textWhite: {
    color: "white",
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 32,
  },
  backButton: {
    marginBottom: 12,
  },
  linkText: {
    color: "#60A5FA",
  },
  card: {
    marginTop: 12,
    backgroundColor: "#020617",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1F2937",
  },
  title: {
    color: "white",
    fontSize: 18,
    fontWeight: "800",
  },
  sectionTitle: {
    color: "white",
    fontWeight: "800",
    marginBottom: 8,
  },
  infoLine: {
    color: "#9CA3AF",
    marginTop: 6,
  },
  infoValue: {
    color: "#E5E7EB",
  },
  strongValue: {
    color: "#F9FAFB",
    fontWeight: "900",
  },
  successValue: {
    color: "#22C55E",
    fontWeight: "900",
  },
  dangerValue: {
    color: "#FCA5A5",
    fontWeight: "900",
  },
  actions: {
    marginTop: 12,
    gap: 10,
  },
  actionButton: {
    marginTop: 12,
    paddingVertical: 12,
    borderRadius: 12,
  },
  disabledButton: {
    opacity: 0.55,
  },
  actionButtonText: {
    color: "white",
    textAlign: "center",
    fontWeight: "900",
  },
  notice: {
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "#1F2937",
    borderRadius: 12,
    padding: 12,
  },
  paragraph: {
    color: "#9CA3AF",
    lineHeight: 19,
  },
  mutedText: {
    color: "#9CA3AF",
    marginTop: 4,
  },
  boldText: {
    color: "#E5E7EB",
    fontWeight: "800",
  },
  labelText: {
    color: "#9CA3AF",
    marginTop: 10,
    fontWeight: "700",
  },
  pickupCodeInput: {
    marginTop: 8,
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "#1F2937",
    borderRadius: 10,
    padding: 12,
    color: "white",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    letterSpacing: 2,
  },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#1F2937",
    backgroundColor: "#0B1220",
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "#1F2937",
    backgroundColor: "#0B1220",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitials: {
    color: "#E5E7EB",
    fontWeight: "900",
    fontSize: 16,
  },
  driverName: {
    color: "#E5E7EB",
    fontWeight: "900",
    fontSize: 16,
  },
  itemRow: {
    paddingVertical: 10,
  },
  itemBorder: {
    borderTopWidth: 1,
    borderTopColor: "#111827",
  },
  itemTotal: {
    color: "#F9FAFB",
    marginTop: 4,
    fontWeight: "800",
  },
});