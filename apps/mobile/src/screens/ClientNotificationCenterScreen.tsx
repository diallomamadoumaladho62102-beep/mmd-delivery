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
  StatusBar,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeLinearGradient as LinearGradient } from "../components/SafeLinearGradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import DriverBrandLoadingState from "../components/driver/DriverBrandLoadingState";
import {
  fetchNotificationInbox,
  notificationDeepLinkTarget,
  patchNotificationInbox,
  type NotificationInboxItem,
} from "../lib/notificationsInboxApi";
import { toUserFacingError } from "../lib/userFacingError";
import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_DARK,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
  mmdLogoSize,
  mmdLogoSizeCompact,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type Nav = NativeStackNavigationProp<RootStackParamList>;

type Props = {
  /** Optional role label for driver alias reuse */
  role?: "client" | "driver";
};

export function ClientNotificationCenterScreen({ role = "client" }: Props) {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<Nav>();
  const { width, height } = useWindowDimensions();
  const logoHero = mmdLogoSize(width, height);
  const logoCompact = mmdLogoSizeCompact(width, height);

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

  const subtitle =
    unread > 0
      ? t("client.notifications.unreadCount", "{{count}} unread", {
          count: unread,
        })
      : t("client.notifications.upToDate", "You're up to date");

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("client.notifications.title", "Notifications")}
        subtitle={subtitle}
        fallbackRoute={fallbackRoute as keyof RootStackParamList}
        variant="dark"
      />

      {loading ? (
        role === "driver" ? (
          <DriverBrandLoadingState
            title={t("shared.common.loading", "Loading")}
          />
        ) : (
          <View style={styles.centered}>
            <Image
              source={MMD_LOGO}
              style={{
                width: logoHero,
                height: logoHero,
                borderRadius: logoHero / 2,
              }}
              resizeMode="contain"
              accessibilityLabel="MMD Delivery"
            />
            <Text style={styles.brandTitle}>MMD DELIVERY</Text>
            <Text style={styles.tagline}>
              {t("brand.tagline", "We Deliver With Heart ❤️")}
            </Text>
            <ActivityIndicator color={MMD_GOLD_BRIGHT} style={{ marginTop: 8 }} />
          </View>
        )
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
              tintColor={MMD_GOLD_BRIGHT}
            />
          }
          ListEmptyComponent={
            role === "driver" ? (
              <View style={styles.emptyBoxDriver}>
                <View style={styles.feedbackCard}>
                  <Text style={styles.emptyTitle}>
                    {error
                      ? t("client.notifications.errorTitle", "Could not load")
                      : t("client.notifications.emptyTitle", "No notifications")}
                  </Text>
                  <Text style={[styles.emptyBody, { color: "#DCE6FA" }]}>
                    {error ??
                      t(
                        "client.notifications.emptyBody",
                        "Push alerts and account updates will appear here."
                      )}
                  </Text>
                </View>
                {error ? (
                  <TouchableOpacity
                    style={styles.retryOuter}
                    onPress={() => void load("full")}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={[MMD_GOLD_DARK, MMD_GOLD_BRIGHT]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.retryBtn}
                    >
                      <Text style={styles.retryLabel}>
                        {t("common.retry", "Retry")}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ) : null}
                <View style={styles.driverLogoBottom}>
                  <Image
                    source={MMD_LOGO}
                    style={{
                      width: logoCompact,
                      height: logoCompact,
                      borderRadius: logoCompact / 2,
                    }}
                    resizeMode="contain"
                    accessibilityLabel="MMD Delivery"
                  />
                  <Text style={styles.driverBrandLabel}>MMD Delivery</Text>
                </View>
              </View>
            ) : (
              <View style={styles.emptyBox}>
                <Image
                  source={MMD_LOGO}
                  style={{
                    width: error ? logoHero : logoCompact,
                    height: error ? logoHero : logoCompact,
                    borderRadius: (error ? logoHero : logoCompact) / 2,
                    marginBottom: 10,
                  }}
                  resizeMode="contain"
                  accessibilityLabel="MMD Delivery"
                />
                {error ? (
                  <>
                    <Text style={styles.brandTitle}>MMD DELIVERY</Text>
                    <Text style={styles.tagline}>
                      {t("brand.tagline", "We Deliver With Heart ❤️")}
                    </Text>
                  </>
                ) : null}
                <View style={styles.feedbackCard}>
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
                </View>
                {error ? (
                  <TouchableOpacity
                    style={styles.retryOuter}
                    onPress={() => void load("full")}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={[MMD_GOLD_DARK, MMD_GOLD_BRIGHT]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.retryBtn}
                    >
                      <Text style={styles.retryLabel}>
                        {t("common.retry", "Retry")}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ) : null}
              </View>
            )
          }
          renderItem={({ item }) => {
            const unreadItem = !item.read_at;
            return (
              <TouchableOpacity
                style={[
                  styles.card,
                  role === "driver"
                    ? unreadItem
                      ? styles.cardUnreadDriver
                      : styles.cardReadDriver
                    : unreadItem
                      ? styles.cardUnread
                      : styles.cardRead,
                ]}
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
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 10,
  },
  brandTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 28,
    textAlign: "center",
  },
  tagline: {
    color: MMD_GOLD_BRIGHT,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 16,
    textAlign: "center",
  },
  listContent: { padding: 16, paddingBottom: 40, gap: 10 },
  emptyContent: { flexGrow: 1, padding: 24, justifyContent: "center" },
  emptyBox: { alignItems: "center", gap: 10 },
  emptyBoxDriver: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    minHeight: 360,
  },
  driverLogoBottom: {
    marginTop: "auto",
    alignItems: "center",
    gap: 8,
    paddingBottom: 24,
  },
  driverBrandLabel: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  feedbackCard: {
    backgroundColor: MMD_NAVY,
    borderColor: MMD_CARD_BORDER,
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    width: "100%",
    maxWidth: 280,
    alignItems: "center",
  },
  emptyTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "800",
    fontSize: 20,
    textAlign: "center",
  },
  emptyBody: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 20,
    fontSize: 15,
    marginTop: 8,
  },
  retryOuter: { marginTop: 8 },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    minHeight: 44,
    minWidth: 71,
    alignItems: "center",
    justifyContent: "center",
  },
  retryLabel: {
    color: MMD_NAVY,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  card: {
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    minHeight: 120,
  },
  cardUnread: {
    backgroundColor: MMD_NAVY,
    borderColor: "rgba(255,215,0,0.3)",
    borderWidth: 1,
  },
  cardRead: {
    backgroundColor: "#001A4D",
    borderColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
  },
  /** Figma Driver Notifications — unread #3B82F6 / read #0037A0 on MMD_BLUE */
  cardUnreadDriver: {
    backgroundColor: MMD_BLUE,
    borderColor: "#3B82F6",
    borderWidth: 1,
  },
  cardReadDriver: {
    backgroundColor: MMD_BLUE,
    borderColor: "#0037A0",
    borderWidth: 1,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 15,
    lineHeight: 20,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: MMD_GOLD_BRIGHT,
    marginTop: 4,
  },
  cardBody: {
    marginTop: 6,
    color: MMD_MUTED,
    fontFamily: MMD_FONT.semibold,
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
  cardWhen: {
    color: MMD_MUTED,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
  },
  archiveLabel: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    fontSize: 12,
  },
});
