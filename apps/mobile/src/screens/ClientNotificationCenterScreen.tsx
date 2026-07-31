import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  fetchNotificationInbox,
  notificationDeepLinkTarget,
  patchNotificationInbox,
  type NotificationInboxItem,
} from "../lib/notificationsInboxApi";
import { toUserFacingError } from "../lib/userFacingError";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Props = {
  /** Optional role label for driver alias reuse */
  role?: "client" | "driver";
};

export function ClientNotificationCenterScreen({ role = "client" }: Props) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [items, setItems] = useState<NotificationInboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const locale = (i18n.resolvedLanguage || i18n.language || "en").toLowerCase();

  const load = useCallback(async (mode: "full" | "refresh" = "full") => {
    if (mode === "full") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const out = await fetchNotificationInbox({ limit: 50 });
      setItems(out.items);
      setUnread(out.unread_count);
    } catch (e) {
      setError(
        toUserFacingError(
          e,
          t(
            "client.notifications.loadError",
            "Unable to load notifications."
          )
        )
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void load("full");
    }, [load])
  );

  const formatWhen = useCallback(
    (iso: string) => {
      try {
        const d = new Date(iso);
        const loc = locale === "zh" ? "zh-CN" : locale;
        return `${d.toLocaleDateString(loc, {
          day: "2-digit",
          month: "short",
        })} ${d.toLocaleTimeString(loc, {
          hour: "2-digit",
          minute: "2-digit",
        })}`;
      } catch {
        return iso;
      }
    },
    [locale]
  );

  const onOpen = useCallback(
    async (item: NotificationInboxItem) => {
      try {
        if (!item.read_at) {
          await patchNotificationInbox(item.id, "read");
          setItems((prev) =>
            prev.map((row) =>
              row.id === item.id
                ? { ...row, read_at: new Date().toISOString() }
                : row
            )
          );
          setUnread((n) => Math.max(0, n - 1));
        }
      } catch {
        // still allow navigation
      }

      const target = notificationDeepLinkTarget(item.data);
      if (!target) return;

      if (target.screen === "ClientOrderDetails") {
        navigation.navigate("ClientOrderDetails", target.params);
      } else if (target.screen === "TaxiRideTracking") {
        navigation.navigate("TaxiRideTracking", target.params);
      } else if (target.screen === "ClientDeliveryRequestDetails") {
        navigation.navigate("ClientDeliveryRequestDetails", target.params);
      }
    },
    [navigation]
  );

  const onArchive = useCallback(
    async (item: NotificationInboxItem) => {
      try {
        await patchNotificationInbox(item.id, "archive");
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        if (!item.read_at) setUnread((n) => Math.max(0, n - 1));
      } catch (e) {
        Alert.alert(
          t("common.error", "Error"),
          toUserFacingError(
            e,
            t("client.notifications.archiveError", "Unable to archive.")
          )
        );
      }
    },
    [t]
  );

  const onMarkRead = useCallback(
    async (item: NotificationInboxItem) => {
      if (item.read_at) return;
      try {
        await patchNotificationInbox(item.id, "read");
        setItems((prev) =>
          prev.map((row) =>
            row.id === item.id
              ? { ...row, read_at: new Date().toISOString() }
              : row
          )
        );
        setUnread((n) => Math.max(0, n - 1));
      } catch (e) {
        Alert.alert(
          t("common.error", "Error"),
          toUserFacingError(
            e,
            t("client.notifications.readError", "Unable to mark as read.")
          )
        );
      }
    },
    [t]
  );

  const fallbackRoute =
    role === "driver" ? "DriverTabs" : "ClientSettings";

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("client.notifications.title", "Notifications")}
        subtitle={
          unread > 0
            ? t("client.notifications.unreadCount", "{{count}} unread", {
                count: unread,
              })
            : t("client.notifications.upToDate", "You're up to date")
        }
        fallbackRoute={fallbackRoute as keyof RootStackParamList}
        variant="dark"
      />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#60A5FA" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={
            items.length === 0 ? styles.emptyContent : styles.listContent
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load("refresh")}
              tintColor="#60A5FA"
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>
                {error
                  ? t("client.notifications.errorTitle", "Could not load")
                  : t("client.notifications.emptyTitle", "No notifications")}
              </Text>
              <Text style={styles.emptyBody}>
                {error ??
                  t(
                    "client.notifications.emptyBody",
                    "Push alerts and account updates will appear here."
                  )}
              </Text>
              {error ? (
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => void load("full")}
                >
                  <Text style={styles.retryLabel}>
                    {t("common.retry", "Retry")}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const unreadItem = !item.read_at;
            return (
              <TouchableOpacity
                style={[styles.card, unreadItem ? styles.cardUnread : null]}
                activeOpacity={0.85}
                onPress={() => void onOpen(item)}
                onLongPress={() => void onMarkRead(item)}
              >
                <View style={styles.cardTop}>
                  <Text style={styles.cardTitle} numberOfLines={2}>
                    {item.title ||
                      t("client.notifications.fallbackTitle", "Notification")}
                  </Text>
                  {unreadItem ? <View style={styles.dot} /> : null}
                </View>
                {item.body ? (
                  <Text style={styles.cardBody} numberOfLines={3}>
                    {item.body}
                  </Text>
                ) : null}
                <View style={styles.cardFooter}>
                  <Text style={styles.cardWhen}>
                    {formatWhen(item.created_at)}
                  </Text>
                  <TouchableOpacity
                    onPress={() => void onArchive(item)}
                    hitSlop={8}
                  >
                    <Text style={styles.archiveLabel}>
                      {t("client.notifications.archive", "Archive")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

/** Optional driver alias — same inbox component */
export function DriverNotificationCenterScreen() {
  return <ClientNotificationCenterScreen role="driver" />;
}

export default ClientNotificationCenterScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#020617" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 16, paddingBottom: 40, gap: 10 },
  emptyContent: { flexGrow: 1, padding: 24, justifyContent: "center" },
  emptyBox: { alignItems: "center", gap: 10 },
  emptyTitle: { color: "#E2E8F0", fontWeight: "800", fontSize: 17 },
  emptyBody: {
    color: "#94A3B8",
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 20,
  },
  retryBtn: {
    marginTop: 8,
    backgroundColor: "#1E3A5F",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryLabel: { color: "#93C5FD", fontWeight: "800" },
  card: {
    backgroundColor: "#0B1220",
    borderColor: "#1E293B",
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  cardUnread: {
    borderColor: "#3B82F6",
    backgroundColor: "#0B1628",
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: { flex: 1, color: "#F8FAFC", fontWeight: "800", fontSize: 15 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#60A5FA",
    marginTop: 4,
  },
  cardBody: {
    marginTop: 6,
    color: "#94A3B8",
    fontWeight: "600",
    fontSize: 13,
    lineHeight: 18,
  },
  cardFooter: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardWhen: { color: "#64748B", fontWeight: "700", fontSize: 11 },
  archiveLabel: { color: "#FCA5A5", fontWeight: "800", fontSize: 12 },
});
