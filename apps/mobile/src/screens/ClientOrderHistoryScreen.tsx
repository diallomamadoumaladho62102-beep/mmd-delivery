/**
 * Client order history — full list (Food / Delivery / Package / Taxi).
 * Main home shows actives or last completed only; this screen is the full history.
 */
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import { applyLiveTripFilters } from "../lib/tripVisibility";
import {
  computeClientOrderStats,
  isClientActiveStatus,
  isClientCancelledStatus,
  isClientCompletedStatus,
  isVisibleClientTrip,
  type ClientTripKind,
} from "../lib/clientOrderDisplay";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

type HistoryItem = {
  id: string;
  kind: ClientTripKind;
  status: string;
  payment_status: string | null;
  created_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  total: number | null;
  is_test?: boolean | null;
  hidden_from_user?: boolean | null;
  archived_at?: string | null;
};

function titleFor(item: HistoryItem): string {
  if (item.kind === "taxi_ride") return "Taxi ride";
  if (item.kind === "delivery_request") return "Package delivery";
  return item.pickup_address?.split(",")[0]?.trim() || "Food order";
}

function badgeFor(kind: ClientTripKind): { label: string; bg: string } {
  if (kind === "taxi_ride") return { label: "TX", bg: "#EAB308" };
  if (kind === "delivery_request") return { label: "DL", bg: "#DC2626" };
  return { label: "FD", bg: "#16A34A" };
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function statusLabel(item: HistoryItem): { text: string; color: string } {
  if (isClientCompletedStatus(item.status)) {
    return {
      text: item.kind === "restaurant_order" ? "Delivered" : "Completed",
      color: "#16A34A",
    };
  }
  if (isClientCancelledStatus(item.status)) {
    return { text: "Cancelled", color: "#F87171" };
  }
  if (isClientActiveStatus(item.status)) {
    return { text: "In progress", color: "#AABEE6" };
  }
  return { text: item.status || "—", color: "#AABEE6" };
}

export default function ClientOrderHistoryScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const contentMaxWidth = width >= 768 ? 720 : undefined;
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);

  const load = useCallback(async (mode: "load" | "refresh" = "load") => {
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        setItems([]);
        return;
      }

      const [ordersRes, drRes, taxiRes] = await Promise.all([
        applyLiveTripFilters(
          supabase
            .from("orders")
            .select(
              "id,status,payment_status,created_at,pickup_address,dropoff_address,total,kind,is_test,hidden_from_user,archived_at",
            ),
        )
          .or(
            `client_user_id.eq.${userId},client_id.eq.${userId},created_by.eq.${userId},user_id.eq.${userId}`,
          )
          .order("created_at", { ascending: false })
          .limit(100),
        applyLiveTripFilters(
          supabase
            .from("delivery_requests")
            .select(
              "id,status,payment_status,created_at,pickup_address,dropoff_address,total,is_test,hidden_from_user,archived_at",
            ),
        )
          .or(`client_user_id.eq.${userId},created_by.eq.${userId}`)
          .order("created_at", { ascending: false })
          .limit(100),
        applyLiveTripFilters(
          supabase
            .from("taxi_rides")
            .select(
              "id,status,payment_status,created_at,pickup_address,dropoff_address,total_cents,is_test,hidden_from_user,archived_at",
            ),
        )
          .eq("client_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      const merged: HistoryItem[] = [];

      for (const row of ordersRes.data ?? []) {
        if (String(row.kind ?? "").toLowerCase() === "pickup_dropoff") continue;
        merged.push({
          id: String(row.id),
          kind: "restaurant_order",
          status: String(row.status ?? ""),
          payment_status: row.payment_status ?? null,
          created_at: row.created_at ?? null,
          pickup_address: row.pickup_address ?? null,
          dropoff_address: row.dropoff_address ?? null,
          total: typeof row.total === "number" ? row.total : null,
          is_test: row.is_test,
          hidden_from_user: row.hidden_from_user,
          archived_at: row.archived_at,
        });
      }

      for (const row of drRes.data ?? []) {
        merged.push({
          id: String(row.id),
          kind: "delivery_request",
          status: String(row.status ?? ""),
          payment_status: row.payment_status ?? null,
          created_at: row.created_at ?? null,
          pickup_address: row.pickup_address ?? null,
          dropoff_address: row.dropoff_address ?? null,
          total: typeof row.total === "number" ? row.total : null,
          is_test: row.is_test,
          hidden_from_user: row.hidden_from_user,
          archived_at: row.archived_at,
        });
      }

      for (const row of taxiRes.data ?? []) {
        merged.push({
          id: String(row.id),
          kind: "taxi_ride",
          status: String(row.status ?? ""),
          payment_status: row.payment_status ?? null,
          created_at: row.created_at ?? null,
          pickup_address: row.pickup_address ?? null,
          dropoff_address: row.dropoff_address ?? null,
          total:
            typeof row.total_cents === "number" ? row.total_cents / 100 : null,
          is_test: row.is_test,
          hidden_from_user: row.hidden_from_user,
          archived_at: row.archived_at,
        });
      }

      merged.sort((a, b) => {
        const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });

      setItems(merged.filter(isVisibleClientTrip));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load("load");
    }, [load]),
  );

  const stats = useMemo(() => computeClientOrderStats(items), [items]);

  const openItem = useCallback(
    (item: HistoryItem) => {
      if (item.kind === "restaurant_order") {
        navigation.navigate("ClientOrderDetails", { orderId: item.id });
        return;
      }
      if (item.kind === "delivery_request") {
        navigation.navigate("ClientDeliveryRequestDetails", {
          requestId: item.id,
        });
        return;
      }
      navigation.navigate("TaxiRideTracking", { rideId: item.id });
    },
    [navigation],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={[styles.header, contentMaxWidth ? { maxWidth: contentMaxWidth, alignSelf: "center", width: "100%" } : null]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} accessibilityRole="button">
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Order history</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={[styles.statsRow, contentMaxWidth ? { maxWidth: contentMaxWidth, alignSelf: "center", width: "100%" } : null]}>
        <Stat label="Active" value={stats.active} />
        <Stat label="Completed" value={stats.completed} />
        <Stat label="Cancelled" value={stats.cancelled} />
        <Stat label="Total" value={stats.totalOrders} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={MMD_GOLD_BRIGHT} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load("refresh")}
              tintColor={MMD_GOLD_BRIGHT}
            />
          }
          contentContainerStyle={{
            paddingBottom: insets.bottom + 24,
            paddingHorizontal: 16,
            maxWidth: contentMaxWidth,
            alignSelf: "center",
            width: "100%",
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>No orders yet.</Text>
          }
          renderItem={({ item }) => {
            const badge = badgeFor(item.kind);
            const status = statusLabel(item);
            const amount =
              typeof item.total === "number" ? `$${item.total.toFixed(2)}` : "—";
            return (
              <Pressable style={styles.row} onPress={() => openItem(item)}>
                <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                  <Text style={styles.badgeText}>{badge.label}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {titleFor(item)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {formatWhen(item.created_at)}
                  </Text>
                </View>
                <View style={styles.rightCol}>
                  <Text style={styles.amount}>{amount}</Text>
                  <Text style={[styles.statusText, { color: status.color }]}>
                    {status.text}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MMD_BLUE },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  back: {
    color: "#1FAF5A",
    fontWeight: "700",
    fontSize: 16,
    width: 72,
    fontFamily: MMD_FONT.bold,
  },
  title: {
    color: MMD_TEXT,
    fontWeight: "800",
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  stat: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.4)",
    paddingVertical: 10,
    alignItems: "center",
  },
  statValue: {
    color: MMD_TEXT,
    fontWeight: "800",
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
  },
  statLabel: {
    color: "#AABEE6",
    fontSize: 11,
    marginTop: 2,
    fontFamily: MMD_FONT.regular,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
    padding: 10,
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: MMD_BLUE,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    gap: 8,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: MMD_WHITE,
    fontWeight: "800",
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
  },
  rowTitle: {
    color: "#AABEE6",
    fontWeight: "800",
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
  },
  rowMeta: {
    color: "#AABEE6",
    marginTop: 1,
    fontSize: 11,
    fontFamily: MMD_FONT.regular,
  },
  rightCol: { alignItems: "flex-end" },
  amount: {
    color: "#AABEE6",
    fontWeight: "800",
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
  },
  statusText: {
    fontWeight: "700",
    fontSize: 10,
    fontFamily: MMD_FONT.bold,
    marginTop: 1,
  },
  chevron: { color: "#AABEE6", fontSize: 16, marginLeft: 2 },
  empty: {
    color: "#AABEE6",
    textAlign: "center",
    marginTop: 48,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
});
