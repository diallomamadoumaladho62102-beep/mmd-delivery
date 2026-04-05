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
} from "react-native";
import { supabase } from "../lib/supabase";
import { useTranslation } from "react-i18next";

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

  items_json: any;
};

type DriverProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

function parseItems(items_json: any): OrderItem[] {
  if (!items_json) return [];
  if (Array.isArray(items_json)) return items_json as OrderItem[];
  if (typeof items_json === "string") {
    try {
      const parsed = JSON.parse(items_json);
      return Array.isArray(parsed) ? (parsed as OrderItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase() || "DR";
}

export function RestaurantOrderDetailsScreen({ route, navigation }: any) {
  const { t, i18n } = useTranslation();

  const { orderId } = route.params as { orderId: string };

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

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

  const fmtDateTime = useCallback(
    (iso?: string | null) => {
      if (!iso) return t("common.na", "—");
      const d = new Date(iso);
      return d.toLocaleString(localeTag);
    },
    [localeTag, t]
  );

  const money = useCallback(
    (n: number | null | undefined, currency: string) => {
      if (n == null || Number.isNaN(n)) return t("common.na", "—");
      return `${Number(n).toFixed(2)} ${currency}`;
    },
    [t]
  );

  // ✅ Statut restaurant (ready dépend de driver_id)
  const restaurantStatusLabel = useCallback(
    (status: OrderStatus, driverId: string | null) => {
      if (status === "ready") {
        if (!driverId)
          return t(
            "order.status.readyWaitingDriver",
            "Prête – en attente d’un chauffeur"
          );
        return t(
          "order.status.readyDriverAssigned",
          "Prête – chauffeur assigné"
        );
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

  const selectFields = [
    "id",
    "status",
    "created_at",
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
  ].join(",");

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(selectFields)
        .eq("id", orderId)
        .maybeSingle();

      if (error || !data) {
        throw (
          error ??
          new Error(t("order.errors.notFound", "Commande introuvable."))
        );
      }

      // ✅ FIX TS2352: cast via unknown (évite GenericStringError -> Order)
      const o = data as unknown as Order;

      setOrder(o);
      setPickupCode((o as any).pickup_code ?? "");
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

  const fetchDriver = useCallback(async (driverId: string) => {
    setDriverLoading(true);
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url")
        .eq("id", driverId)
        .maybeSingle();

      if (error) throw error;

      // ✅ safe cast via unknown
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

  // ✅ Realtime sur cette commande
  useEffect(() => {
    const ch = supabase
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
          void fetchOrder();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [orderId, fetchOrder]);

  // ✅ charger driver quand driver_id change
  useEffect(() => {
    const id = order?.driver_id ?? null;
    if (!id) {
      setDriver(null);
      return;
    }
    void fetchDriver(id);
  }, [order?.driver_id, fetchDriver]);

  const updateStatus = useCallback(
    async (next: OrderStatus) => {
      if (!order) return;

      setUpdating(true);
      try {
        const { data, error } = await supabase
          .from("orders")
          .update({ status: next })
          .eq("id", order.id)
          .select(selectFields)
          .single();

        if (error || !data) {
          throw (
            error ??
            new Error(
              t("order.errors.updateStatus", "Update status failed.")
            )
          );
        }

        // ✅ FIX TS2352: cast via unknown
        const o = data as unknown as Order;

        setOrder(o);
        setPickupCode((o as any).pickup_code ?? "");
      } catch (e: any) {
        Alert.alert(
          t("common.errorTitle", "Erreur"),
          e?.message ??
            t("order.errors.update", "Impossible de mettre à jour le statut.")
        );
      } finally {
        setUpdating(false);
      }
    },
    [order, selectFields, t]
  );

  const currency = order?.currency ?? "USD";

  const items = useMemo(
    () => (order ? parseItems(order.items_json) : []),
    [order]
  );

  const itemsPlusTax = useMemo(() => {
    const s = order?.subtotal ?? 0;
    const tx = order?.tax ?? 0;
    return s + tx;
  }, [order?.subtotal, order?.tax]);

  // ----------------------------
  // RENDERS
  // ----------------------------
  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator />
          <Text style={{ color: "white", marginTop: 8 }}>
            {t("common.loading", "Chargement…")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!order) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, padding: 16 }}>
          <Text style={{ color: "white" }}>
            {t("order.errors.notFound", "Commande introuvable.")}
          </Text>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ marginTop: 12 }}
          >
            <Text style={{ color: "#60A5FA" }}>
              {t("common.back", "← Retour")}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canAccept = order.status === "pending";
  const canPrepare = order.status === "accepted";
  const canReady = order.status === "prepared";

  const driverName =
    driver?.full_name?.trim() ||
    (order.driver_id
      ? t("order.driver.fallback", {
          defaultValue: "Chauffeur {{id}}",
          id: order.driver_id.slice(0, 8),
        })
      : null);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#111827" }}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={{ marginBottom: 12 }}
          >
            <Text style={{ color: "#60A5FA" }}>
              {t("order.details.backToOrders", "← Retour aux commandes")}
            </Text>
          </TouchableOpacity>

          {/* HEADER */}
          <View
            style={{
              backgroundColor: "#020617",
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "white", fontSize: 18, fontWeight: "800" }}>
              {t("order.details.title", {
                defaultValue: "Commande #{{id}}",
                id: order.id.slice(0, 8),
              })}
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
              {t("order.details.statusLabel", "Statut")} :{" "}
              <Text style={{ color: "#E5E7EB" }}>
                {restaurantStatusLabel(order.status, order.driver_id)}
              </Text>
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
              {t("order.details.createdAt", "Créée")} :{" "}
              <Text style={{ color: "#E5E7EB" }}>
                {fmtDateTime(order.created_at)}
              </Text>
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
              {t("order.details.totalItemsTaxes", "Total (plats + taxes)")} :{" "}
              <Text style={{ color: "#F9FAFB" }}>
                {money(itemsPlusTax, currency)}
              </Text>
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
              {t("order.details.netRestaurant", "Net restaurant")} :{" "}
              <Text style={{ color: "#22C55E", fontWeight: "900" }}>
                {money(order.restaurant_net_amount, currency)}
              </Text>
            </Text>
          </View>

          {/* ACTIONS */}
          <View style={{ marginTop: 12, gap: 10 }}>
            {canAccept && (
              <TouchableOpacity
                disabled={updating}
                onPress={() => updateStatus("accepted")}
                style={{
                  backgroundColor: "#EA580C",
                  paddingVertical: 12,
                  borderRadius: 12,
                  opacity: updating ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    color: "white",
                    textAlign: "center",
                    fontWeight: "800",
                  }}
                >
                  {updating
                    ? t("common.updating", "Mise à jour…")
                    : t("order.actions.accept", "Accepter la commande")}
                </Text>
              </TouchableOpacity>
            )}

            {canPrepare && (
              <TouchableOpacity
                disabled={updating}
                onPress={() => updateStatus("prepared")}
                style={{
                  backgroundColor: "#F97316",
                  paddingVertical: 12,
                  borderRadius: 12,
                  opacity: updating ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    color: "white",
                    textAlign: "center",
                    fontWeight: "800",
                  }}
                >
                  {updating
                    ? t("common.updating", "Mise à jour…")
                    : t("order.actions.toPreparing", "Passer en préparation")}
                </Text>
              </TouchableOpacity>
            )}

            {canReady && (
              <TouchableOpacity
                disabled={updating}
                onPress={() => updateStatus("ready")}
                style={{
                  backgroundColor: "#16A34A",
                  paddingVertical: 12,
                  borderRadius: 12,
                  opacity: updating ? 0.5 : 1,
                }}
              >
                <Text
                  style={{
                    color: "white",
                    textAlign: "center",
                    fontWeight: "800",
                  }}
                >
                  {updating
                    ? t("common.updating", "Mise à jour…")
                    : t("order.actions.ready", "Commande prête (READY)")}
                </Text>
              </TouchableOpacity>
            )}

            {!canAccept && !canPrepare && !canReady && (
              <View
                style={{
                  backgroundColor: "#0B1220",
                  borderWidth: 1,
                  borderColor: "#1F2937",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <Text style={{ color: "#9CA3AF" }}>
                  {t(
                    "order.actions.none",
                    "Aucune action restaurant requise maintenant."
                  )}
                </Text>
              </View>
            )}
          </View>

          {/* BLOC RESTAURANT */}
          <View
            style={{
              marginTop: 12,
              backgroundColor: "#020617",
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "white", fontWeight: "800", marginBottom: 8 }}>
              {t("order.details.restaurantSection", "Restaurant")}
            </Text>

            <Text style={{ color: "#E5E7EB", fontWeight: "800" }}>
              {order.restaurant_name ?? t("common.na", "—")}
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 8 }}>
              {t(
                "order.details.pickupAddress",
                "Adresse de récupération"
              )}{" "}
              :{" "}
              <Text style={{ color: "#E5E7EB" }}>
                {order.pickup_address ?? t("common.na", "—")}
              </Text>
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 10, fontWeight: "700" }}>
              {t(
                "order.details.pickupCodeHelp",
                "Code pickup à donner au chauffeur :"
              )}
            </Text>

            <TextInput
              value={pickupCode || t("common.na", "—")}
              editable={false}
              style={{
                marginTop: 8,
                backgroundColor: "#0B1220",
                borderWidth: 1,
                borderColor: "#1F2937",
                borderRadius: 10,
                padding: 12,
                color: "white",
                fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                letterSpacing: 2,
              }}
            />
          </View>

          {/* CHAUFFEUR */}
          <View
            style={{
              marginTop: 12,
              backgroundColor: "#020617",
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "white", fontWeight: "800", marginBottom: 8 }}>
              {t("order.details.driverSection", "Chauffeur")}
            </Text>

            {!order.driver_id ? (
              <Text style={{ color: "#9CA3AF" }}>
                {t(
                  "order.driver.none",
                  "Aucun chauffeur n’est encore assigné à cette commande."
                )}
              </Text>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                {driver?.avatar_url ? (
                  <Image
                    source={{ uri: driver.avatar_url }}
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      borderWidth: 1,
                      borderColor: "#1F2937",
                      backgroundColor: "#0B1220",
                    }}
                  />
                ) : (
                  <View
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 28,
                      borderWidth: 1,
                      borderColor: "#1F2937",
                      backgroundColor: "#0B1220",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#E5E7EB",
                        fontWeight: "900",
                        fontSize: 16,
                      }}
                    >
                      {initials(driverName ?? "Driver")}
                    </Text>
                  </View>
                )}

                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: "#E5E7EB",
                      fontWeight: "900",
                      fontSize: 16,
                    }}
                  >
                    {driverName ?? t("order.driver.title", "Chauffeur")}
                  </Text>
                  <Text style={{ color: "#9CA3AF", marginTop: 4 }}>
                    {driverLoading
                      ? t("order.driver.loading", "Chargement du profil…")
                      : t("order.driver.profile", "Profil chauffeur")}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* RÉCAP */}
          <View
            style={{
              marginTop: 12,
              backgroundColor: "#020617",
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "white", fontWeight: "800", marginBottom: 8 }}>
              {t("order.details.summary", "Récapitulatif de la commande")}
            </Text>

            {items.length === 0 ? (
              <Text style={{ color: "#9CA3AF" }}>
                {t("order.details.noItems", "Aucun article.")}
              </Text>
            ) : (
              items.map((it, idx) => {
                const line = it.line_total ?? it.unit_price * it.quantity;
                return (
                  <View
                    key={`${it.name}-${idx}`}
                    style={{
                      paddingVertical: 10,
                      borderTopWidth: idx === 0 ? 0 : 1,
                      borderTopColor: "#111827",
                    }}
                  >
                    <Text style={{ color: "#E5E7EB", fontWeight: "800" }}>
                      {it.name}
                    </Text>

                    {it.category ? (
                      <Text style={{ color: "#9CA3AF", marginTop: 2 }}>
                        {it.category}
                      </Text>
                    ) : null}

                    <Text style={{ color: "#9CA3AF", marginTop: 4 }}>
                      {t("order.details.qty", {
                        defaultValue: "Qté {{q}}",
                        q: it.quantity,
                      })}{" "}
                      — {money(it.unit_price, currency)}
                      {t("order.details.perUnit", " / unité")}
                    </Text>

                    <Text
                      style={{
                        color: "#F9FAFB",
                        marginTop: 4,
                        fontWeight: "800",
                      }}
                    >
                      {t("order.details.line", "Ligne")} :{" "}
                      {money(line, currency)}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* TOTAUX + NET RESTAURANT */}
          <View
            style={{
              marginTop: 12,
              backgroundColor: "#020617",
              borderRadius: 12,
              padding: 16,
              borderWidth: 1,
              borderColor: "#1F2937",
            }}
          >
            <Text style={{ color: "white", fontWeight: "800", marginBottom: 8 }}>
              {t("order.details.totalsRestaurant", "Totaux (restaurant)")}
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 2 }}>
              {t("order.details.subtotal", "Subtotal (plats)")} :{" "}
              <Text style={{ color: "#E5E7EB" }}>
                {money(order.subtotal, currency)}
              </Text>
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
              {t("order.details.taxes", "Taxes")} :{" "}
              <Text style={{ color: "#E5E7EB" }}>{money(order.tax, currency)}</Text>
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
              {t("order.details.itemsPlusTax", "Total plats + taxes")} :{" "}
              <Text style={{ color: "#F9FAFB", fontWeight: "900" }}>
                {money(itemsPlusTax, currency)}
              </Text>
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 10 }}>
              {t("order.details.commission", "Commission restaurant")} :{" "}
              <Text style={{ color: "#FCA5A5", fontWeight: "900" }}>
                {money(order.restaurant_commission_amount, currency)}
              </Text>
              {order.restaurant_commission_rate != null ? (
                <Text style={{ color: "#9CA3AF" }}>
                  {" "}
                  ({(order.restaurant_commission_rate * 100).toFixed(0)}%)
                </Text>
              ) : null}
            </Text>

            <Text style={{ color: "#9CA3AF", marginTop: 6 }}>
              {t("order.details.netRestaurant", "Net restaurant")} :{" "}
              <Text style={{ color: "#22C55E", fontWeight: "900" }}>
                {money(order.restaurant_net_amount, currency)}
              </Text>
            </Text>

            <Text style={{ color: "#64748B", marginTop: 10, fontSize: 12 }}>
              {t("order.details.debugTotalDb", {
                defaultValue: "(Debug) total DB : {{v}}",
                v: money(order.total, currency),
              })}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}