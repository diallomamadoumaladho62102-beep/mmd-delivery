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
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import {
  computeClientOrderStats,
  isClientActiveStatus,
  isClientCancelledStatus,
  isClientCompletedStatus,
  isVisibleClientTrip,
  type ClientTripKind,
} from "../lib/clientOrderDisplay";

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
  return item.pickup_address?.split(",")[0]?.trim() || "Restaurant order";
}

export default function ClientOrderHistoryScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
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
        supabase
          .from("orders")
          .select(
            "id,status,payment_status,created_at,pickup_address,dropoff_address,total,kind,is_test,hidden_from_user,archived_at",
          )
          .or(
            `client_user_id.eq.${userId},client_id.eq.${userId},created_by.eq.${userId},user_id.eq.${userId}`,
          )
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("delivery_requests")
          .select(
            "id,status,payment_status,created_at,pickup_address,dropoff_address,total,is_test,hidden_from_user,archived_at",
          )
          .or(`client_user_id.eq.${userId},created_by.eq.${userId}`)
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("taxi_rides")
          .select(
            "id,status,payment_status,created_at,pickup_address,dropoff_address,total_cents,is_test,hidden_from_user,archived_at",
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
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Order history</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={styles.statsRow}>
        <Stat label="Active" value={stats.active} />
        <Stat label="Completed" value={stats.completed} />
        <Stat label="Cancelled" value={stats.cancelled} />
        <Stat label="Total" value={stats.totalOrders} />
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#1FAF5A" />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.kind}-${item.id}`}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load("refresh")}
              tintColor="#1FAF5A"
            />
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <Text style={styles.empty}>No orders yet.</Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => openItem(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{titleFor(item)}</Text>
                <Text style={styles.rowMeta}>
                  {item.status}
                  {isClientActiveStatus(item.status)
                    ? " · In progress"
                    : isClientCompletedStatus(item.status)
                      ? " · Completed"
                      : isClientCancelledStatus(item.status)
                        ? " · Cancelled"
                        : ""}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          )}
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
  root: { flex: 1, backgroundColor: "#0B1220" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  back: { color: "#1FAF5A", fontWeight: "700", fontSize: 16, width: 48 },
  title: { color: "#F4F7FB", fontWeight: "800", fontSize: 18 },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  stat: {
    flex: 1,
    backgroundColor: "#141C2B",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  statValue: { color: "#F4F7FB", fontWeight: "900", fontSize: 16 },
  statLabel: { color: "#8B97AB", fontSize: 11, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "#141C2B",
  },
  rowTitle: { color: "#F4F7FB", fontWeight: "700", fontSize: 15 },
  rowMeta: { color: "#8B97AB", marginTop: 4, fontSize: 12 },
  chevron: { color: "#8B97AB", fontSize: 22, marginLeft: 8 },
  empty: {
    color: "#8B97AB",
    textAlign: "center",
    marginTop: 48,
    fontSize: 14,
  },
});
