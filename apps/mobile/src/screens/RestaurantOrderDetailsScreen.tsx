import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { API_BASE_URL } from "../lib/apiBase";
import { requestOrderPrint } from "../lib/restaurantOrderAutomationApi";
import { supabase } from "../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";

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
  quantity: number;
  options?: unknown;
  notes?: unknown;
  category?: string | null;
};

type Order = {
  id: string;
  status: OrderStatus;
  created_at: string | null;
  restaurant_id?: string | null;
  restaurant_user_id?: string | null;
  client_id: string | null;
  client_user_id?: string | null;
  restaurant_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_code: string | null;
  items_json: unknown;
  leave_at_door: boolean | null;
  payment_status: string | null;
  kind: string | null;
};

type ClientProfile = {
  id: string;
  full_name: string | null;
  phone?: string | null;
};

const SELECT_FIELDS = [
  "id",
  "status",
  "created_at",
  "restaurant_id",
  "restaurant_user_id",
  "client_id",
  "client_user_id",
  "restaurant_name",
  "pickup_address",
  "dropoff_address",
  "pickup_code",
  "items_json",
  "leave_at_door",
  "payment_status",
  "kind",
].join(",");

function getApiUrl(path: string) {
  const base = String(API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (!base || !/^https?:\/\//i.test(base)) {
    throw new Error("API_BASE_URL doit être une URL absolue.");
  }
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function parseItems(value: unknown): OrderItem[] {
  if (Array.isArray(value)) return value as OrderItem[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as OrderItem[]) : [];
  } catch {
    return [];
  }
}

function textLines(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(textLines);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(textLines);
  }
  return [];
}

function statusLabel(status: OrderStatus) {
  const labels: Record<OrderStatus, string> = {
    pending: "EN ATTENTE",
    accepted: "ACCEPTÉE",
    prepared: "EN PRÉPARATION",
    ready: "PRÊTE",
    dispatched: "EN LIVRAISON",
    delivered: "LIVRÉE",
    canceled: "ANNULÉE",
  };
  return labels[status];
}

function canRestaurantCancel(status: OrderStatus) {
  return ["pending", "accepted", "prepared"].includes(status);
}

function canMoveToStatus(current: OrderStatus, next: OrderStatus) {
  return (
    (current === "pending" && next === "accepted") ||
    (current === "accepted" && next === "prepared") ||
    (current === "prepared" && next === "ready")
  );
}

export function RestaurantOrderDetailsScreen({ route }: any) {
  const { t, i18n } = useTranslation();
  const { orderId } = (route.params ?? {}) as { orderId?: string };
  const [order, setOrder] = useState<Order | null>(null);
  const [client, setClient] = useState<ClientProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);

  const locale = useMemo(
    () => (String(i18n.language).toLowerCase().startsWith("fr") ? "fr-FR" : "en-US"),
    [i18n.language],
  );

  const createdAt = useMemo(
    () => (order?.created_at ? new Date(order.created_at).toLocaleString(locale) : "—"),
    [locale, order?.created_at],
  );
  const items = useMemo(() => parseItems(order?.items_json), [order?.items_json]);
  const kitchenNotes = useMemo(
    () =>
      items.flatMap((item) =>
        textLines(item.notes).map((note) => `${item.name}: ${note}`),
      ),
    [items],
  );

  const resolveRestaurantUser = useCallback(async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const uid = authData.user?.id;
    if (!uid) {
      throw new Error(t("auth.errors.sessionExpired", "Session expirée. Reconnecte-toi puis réessaie."));
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", uid)
      .maybeSingle();
    if (profileError || String((profile as { role?: string } | null)?.role || "").toLowerCase() !== "restaurant") {
      throw new Error(t("order.errors.restaurantOnly", "Cette page est réservée au compte restaurant."));
    }

    setRestaurantUserId(uid);
    return uid;
  }, [t]);

  const validateOrder = useCallback(
    (row: any, uid: string) => {
      const belongsToRestaurant =
        String(row?.restaurant_user_id || "") === uid ||
        String(row?.restaurant_id || "") === uid;
      if (!belongsToRestaurant) {
        throw new Error(t("order.errors.notAllowed", "Tu n’as pas accès à cette commande."));
      }
      if (String(row?.payment_status || "").toLowerCase() !== "paid") {
        throw new Error(t("order.errors.awaitingPayment", "Cette commande n’est pas encore payée et n’est pas visible."));
      }
      if (String(row?.kind || "").toLowerCase() !== "food") {
        throw new Error(t("order.errors.notFoodOrder", "Cette commande n’est pas une commande restaurant."));
      }
    },
    [t],
  );

  const loadClient = useCallback(async (clientId: string | null) => {
    if (!clientId) {
      setClient(null);
      return;
    }

    const query = () =>
      supabase.from("profiles").select("id, full_name, phone").eq("id", clientId).maybeSingle();
    const { data, error } = await query();
    if (!error) {
      setClient((data as ClientProfile | null) ?? null);
      return;
    }

    // Phone is optional in deployments that have not added the column yet.
    const fallback = await supabase.from("profiles").select("id, full_name").eq("id", clientId).maybeSingle();
    setClient((fallback.data as ClientProfile | null) ?? null);
  }, []);

  const fetchOrder = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const uid = restaurantUserId ?? (await resolveRestaurantUser());
        const { data, error } = await supabase
          .from("orders")
          .select(SELECT_FIELDS)
          .eq("id", orderId)
          .maybeSingle();
        if (error || !data) throw error ?? new Error(t("order.errors.notFound", "Commande introuvable."));

        validateOrder(data, uid);
        const nextOrder = data as unknown as Order;
        setOrder(nextOrder);
        void loadClient(nextOrder.client_user_id ?? nextOrder.client_id);
        return nextOrder;
      } catch (error: any) {
        if (!silent) {
          Alert.alert(t("common.errorTitle", "Erreur"), error?.message ?? t("order.errors.load", "Impossible de charger la commande."));
        }
        setOrder(null);
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [loadClient, orderId, resolveRestaurantUser, restaurantUserId, t, validateOrder],
  );

  useEffect(() => {
    void fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    const channel = subscribePostgresChannel(`restaurant-order:${orderId}`, [
      {
        event: "*",
        table: "orders",
        filter: `id=eq.${orderId}`,
        callback: () => void fetchOrder(true),
      },
    ]);
    return () => {
      void unsubscribeSupabaseChannel(channel);
    };
  }, [fetchOrder, orderId]);

  const updateStatus = useCallback(
    async (next: "accepted" | "prepared" | "ready") => {
      if (!order || updating || !restaurantUserId || !canMoveToStatus(order.status, next)) return;
      setUpdating(true);
      try {
        const { postRestaurantOrderStatus } = await import("../lib/restaurantOrderStatusApi");
        await postRestaurantOrderStatus({ orderId: order.id, status: next });
        await fetchOrder(true);
      } catch (error: any) {
        Alert.alert(t("common.errorTitle", "Erreur"), error?.message ?? t("order.errors.update", "Impossible de mettre à jour le statut."));
      } finally {
        setUpdating(false);
      }
    },
    [fetchOrder, order, restaurantUserId, t, updating],
  );

  const cancelOrder = useCallback(async () => {
    if (!order || updating || !canRestaurantCancel(order.status)) return;
    setUpdating(true);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) throw new Error(error?.message || "Session expirée.");
      const response = await fetch(getApiUrl("/api/orders/cancel"), {
        method: "POST",
        headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, role: "restaurant" }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || t("order.errors.cancel", "Impossible d’annuler cette commande."));
      await fetchOrder(true);
    } catch (error: any) {
      Alert.alert(t("common.errorTitle", "Erreur"), error?.message ?? t("order.errors.cancel", "Impossible d’annuler cette commande."));
    } finally {
      setUpdating(false);
    }
  }, [fetchOrder, order, t, updating]);

  const confirmCancel = useCallback(() => {
    if (!order) return;
    Alert.alert(
      order.status === "pending" ? "Refuser la commande" : "Annuler la commande",
      "Confirmer cette action ?",
      [{ text: "Non", style: "cancel" }, { text: "Confirmer", style: "destructive", onPress: () => void cancelOrder() }],
    );
  }, [cancelOrder, order]);

  const handlePrint = useCallback(
    async (source: "manual" | "reprint") => {
      if (!order || printing) return;
      setPrinting(true);
      try {
        await requestOrderPrint(order.id, source);
        Alert.alert("Impression", source === "reprint" ? "Réimpression lancée." : "Ticket ajouté à la file d’impression.");
      } catch (error) {
        Alert.alert("Impression", error instanceof Error ? error.message : "Impossible de lancer l’impression.");
      } finally {
        setPrinting(false);
      }
    },
    [order, printing],
  );

  if (loading) {
    return <SafeAreaView style={styles.screen}><StatusBar barStyle="light-content" /><View style={styles.center}><ActivityIndicator color="#F5C542" /><Text style={styles.muted}>Chargement…</Text></View></SafeAreaView>;
  }

  if (!order) {
    return <SafeAreaView style={styles.screen}><StatusBar barStyle="light-content" /><ScreenHeader title="Commande" fallbackRoute="RestaurantCommandCenter" variant="dark" /><View style={styles.center}><Text style={styles.empty}>Commande introuvable.</Text></View></SafeAreaView>;
  }

  const clientId = order.client_user_id ?? order.client_id;
  const firstName = client?.full_name?.trim().split(/\s+/)[0];
  const clientName = firstName || (clientId ? `Client ${clientId.slice(0, 8)}` : "Client");
  const canPrint = ["accepted", "prepared", "ready", "dispatched"].includes(order.status);

  return (
    <SafeAreaView style={styles.screen} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={`Commande #${order.id.slice(0, 8)}`}
        fallbackRoute="RestaurantCommandCenter"
        variant="dark"
        rightSlot={<View style={styles.statusPill}><Text style={styles.statusText}>{statusLabel(order.status)}</Text></View>}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.restaurantRow}>
            <View style={styles.iconCircle}><Ionicons name="restaurant" size={22} color="#0B0F1A" /></View>
            <View style={styles.flex}>
              <Text style={styles.restaurantName}>{order.restaurant_name || "Restaurant"}</Text>
              <Text style={styles.address}>{order.pickup_address || "Adresse de récupération indisponible"}</Text>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{createdAt}</Text>
            <Text style={styles.deliveryType}>LIVRAISON</Text>
          </View>
        </View>

        <View style={styles.pickupCard}>
          <Ionicons name="lock-closed" size={22} color="#8A6500" />
          <Text style={styles.pickupLabel}>CODE PICKUP</Text>
          <Text style={styles.pickupCode}>{order.pickup_code || "—"}</Text>
          <Text style={styles.pickupHelp}>Communiquez ce code uniquement au livreur.</Text>
        </View>

        <Section icon="person-outline" title="CLIENT">
          <Text style={styles.primaryText}>{clientName}</Text>
          {client?.phone ? <Text style={styles.secondaryText}>{client.phone}</Text> : null}
        </Section>

        <Section icon="location-outline" title="ADRESSE DE LIVRAISON">
          <Text style={styles.primaryText}>{order.dropoff_address || "Adresse indisponible"}</Text>
        </Section>

        {order.leave_at_door ? (
          <Section icon="hand-left-outline" title="INSTRUCTIONS CLIENT">
            <Text style={styles.primaryText}>Laisser à la porte</Text>
          </Section>
        ) : null}

        <Section icon="receipt-outline" title="DÉTAILS DE LA COMMANDE">
          {items.length ? items.map((item, index) => (
            <View key={`${item.name}-${index}`} style={[styles.itemRow, index > 0 && styles.itemDivider]}>
              <View style={styles.quantityBadge}><Text style={styles.quantityText}>{item.quantity}</Text></View>
              <View style={styles.flex}>
                <Text style={styles.itemName}>{item.name}</Text>
                {item.category ? <Text style={styles.optionText}>{item.category}</Text> : null}
                {textLines(item.options).map((option, optionIndex) => <Text key={`${option}-${optionIndex}`} style={styles.optionText}>• {option}</Text>)}
              </View>
            </View>
          )) : <Text style={styles.secondaryText}>Aucun article.</Text>}
        </Section>

        {kitchenNotes.length ? (
          <View style={styles.notesCard}>
            <View style={styles.sectionHeading}><Ionicons name="restaurant-outline" size={18} color="#F5C542" /><Text style={styles.notesTitle}>NOTES CUISINE</Text></View>
            {kitchenNotes.map((note, index) => <Text key={`${note}-${index}`} style={styles.noteText}>• {note}</Text>)}
          </View>
        ) : null}

        {(order.status === "pending" || order.status === "accepted" || order.status === "prepared") ? (
          <View style={styles.workflow}>
            {order.status === "pending" ? <WorkflowButton label="Accepter" icon="checkmark-circle-outline" onPress={() => void updateStatus("accepted")} disabled={updating} /> : null}
            {order.status === "accepted" ? <WorkflowButton label="Préparation" icon="flame-outline" onPress={() => void updateStatus("prepared")} disabled={updating} /> : null}
            {order.status === "prepared" ? <WorkflowButton label="Prête" icon="checkmark-done-outline" onPress={() => void updateStatus("ready")} disabled={updating} /> : null}
            {canRestaurantCancel(order.status) ? <WorkflowButton label={order.status === "pending" ? "Refuser" : "Annuler"} icon="close-circle-outline" onPress={confirmCancel} disabled={updating} destructive /> : null}
          </View>
        ) : null}

        {canPrint ? (
          <View style={styles.printRow}>
            <TouchableOpacity style={[styles.printButton, styles.printButtonDark, printing && styles.disabled]} disabled={printing || updating} onPress={() => void handlePrint("manual")}><Ionicons name="print-outline" size={18} color="#F8FAFC" /><Text style={styles.printDarkText}>{printing ? "Impression…" : "Imprimer"}</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.printButton, styles.printButtonGold, printing && styles.disabled]} disabled={printing || updating} onPress={() => void handlePrint("reprint")}><Ionicons name="refresh-outline" size={18} color="#0B0F1A" /><Text style={styles.printGoldText}>Réimprimer</Text></TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }) {
  return <View style={styles.card}><View style={styles.sectionHeading}><Ionicons name={icon} size={18} color="#F5C542" /><Text style={styles.sectionTitle}>{title}</Text></View>{children}</View>;
}

function WorkflowButton({ label, icon, onPress, disabled, destructive }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled: boolean; destructive?: boolean }) {
  return <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.workflowButton, destructive && styles.destructiveButton, disabled && styles.disabled]}><Ionicons name={icon} size={17} color={destructive ? "#FCA5A5" : "#F5C542"} /><Text style={[styles.workflowText, destructive && styles.destructiveText]}>{disabled ? "Mise à jour…" : label}</Text></TouchableOpacity>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B0F1A" },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  content: { padding: 16, paddingBottom: 32, gap: 14 },
  muted: { color: "#94A3B8", marginTop: 10 },
  empty: { color: "#F8FAFC", fontSize: 16 },
  statusPill: { backgroundColor: "#F5C542", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  statusText: { color: "#0B0F1A", fontSize: 10, fontWeight: "900", letterSpacing: .5 },
  card: { backgroundColor: "#020617", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#1E293B" },
  restaurantRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#F5C542", alignItems: "center", justifyContent: "center" },
  restaurantName: { color: "#F8FAFC", fontSize: 17, fontWeight: "800" },
  address: { color: "#94A3B8", marginTop: 3, lineHeight: 19 },
  metaRow: { borderTopWidth: 1, borderTopColor: "#172033", paddingTop: 12, marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  meta: { color: "#64748B", fontSize: 12 },
  deliveryType: { color: "#F5C542", fontSize: 11, fontWeight: "800", letterSpacing: .8 },
  pickupCard: { backgroundColor: "#F8FAFC", borderRadius: 22, padding: 20, alignItems: "center", borderWidth: 2, borderColor: "#F5C542" },
  pickupLabel: { color: "#8A6500", fontWeight: "900", fontSize: 12, letterSpacing: 1.8, marginTop: 8 },
  pickupCode: { color: "#0B0F1A", fontSize: 40, lineHeight: 48, fontWeight: "900", letterSpacing: 5, marginVertical: 6 },
  pickupHelp: { color: "#475569", fontSize: 12, textAlign: "center" },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionTitle: { color: "#F5C542", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  primaryText: { color: "#F8FAFC", fontSize: 16, fontWeight: "700", lineHeight: 22 },
  secondaryText: { color: "#94A3B8", marginTop: 5, lineHeight: 19 },
  itemRow: { flexDirection: "row", gap: 12, paddingVertical: 10 },
  itemDivider: { borderTopWidth: 1, borderTopColor: "#172033" },
  quantityBadge: { width: 28, height: 28, borderRadius: 8, backgroundColor: "#F5C542", alignItems: "center", justifyContent: "center" },
  quantityText: { color: "#0B0F1A", fontWeight: "900" },
  itemName: { color: "#F8FAFC", fontSize: 16, fontWeight: "800" },
  optionText: { color: "#94A3B8", marginTop: 4, lineHeight: 18 },
  notesCard: { backgroundColor: "#251E09", borderRadius: 20, padding: 16, borderWidth: 1, borderColor: "#5C4810" },
  notesTitle: { color: "#F5C542", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  noteText: { color: "#FDE68A", lineHeight: 21, marginTop: 4 },
  workflow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  workflowButton: { flexGrow: 1, flexBasis: "45%", minHeight: 44, flexDirection: "row", gap: 7, alignItems: "center", justifyContent: "center", backgroundColor: "#131C2E", borderWidth: 1, borderColor: "#334155", borderRadius: 12, paddingHorizontal: 10 },
  workflowText: { color: "#F8FAFC", fontWeight: "800" },
  destructiveButton: { borderColor: "#7F1D1D", backgroundColor: "#220C10" },
  destructiveText: { color: "#FCA5A5" },
  printRow: { flexDirection: "row", gap: 10, marginTop: 2 },
  printButton: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  printButtonDark: { backgroundColor: "#172033", borderWidth: 1, borderColor: "#334155" },
  printButtonGold: { backgroundColor: "#F5C542" },
  printDarkText: { color: "#F8FAFC", fontWeight: "900" },
  printGoldText: { color: "#0B0F1A", fontWeight: "900" },
  disabled: { opacity: .5 },
});

export default RestaurantOrderDetailsScreen;
