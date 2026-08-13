import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { useRestaurantCommandCenter } from "../../features/restaurant/hooks/useRestaurantCommandCenter";
import { useRestaurantAvailability } from "../../hooks/useRestaurantAvailability";
import { RestaurantKpiCard } from "../../features/restaurant/components/RestaurantKpiCard";
import { LiveOperationsCenter } from "../../features/restaurant/components/LiveOperationsCenter";
import { RestaurantLiveMap } from "../../features/restaurant/components/RestaurantLiveMap";
import { RestaurantAiGrowthManager } from "../../features/restaurant/components/RestaurantAiGrowthManager";
import { TopProductsCard } from "../../features/restaurant/components/TopProductsCard";
import { FinancialSummaryCard } from "../../features/restaurant/components/FinancialSummaryCard";
import { RevenueHeroCard } from "../../features/restaurant/components/RevenueHeroCard";
import { RevenueTrendChart } from "../../features/restaurant/components/RevenueTrendChart";
import { OrderInsightsCard } from "../../features/restaurant/components/OrderInsightsCard";
import { CC } from "../../features/restaurant/components/commandCenterTheme";
import { RestaurantBrandLoadingState } from "../../components/restaurant/RestaurantBrandLoadingState";
import { formatDate, formatMoney } from "../../i18n/formatters";
import { rowDirection, textAlignStart } from "../../i18n/rtl";
import { MMD_BLUE, MMD_FONT, MMD_TAXI_GREEN, MMD_WHITE } from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

type Props = NativeStackScreenProps<RootStackParamList, "RestaurantCommandCenter">;

export default function RestaurantCommandCenterScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { data, aiGrowth, loading, refreshing, error, refresh, restaurantUserId } =
    useRestaurantCommandCenter();
  const { availabilityLoading, confirmToggleAvailability } = useRestaurantAvailability();
  const [mapFocusOrderId, setMapFocusOrderId] = useState<string | null>(null);
  const [isOpenOverride, setIsOpenOverride] = useState<boolean | null>(null);

  const isRestaurantOpen = isOpenOverride ?? data?.restaurant.isOpen ?? false;

  const currency = data?.restaurant.currency ?? data?.kpis.currency ?? "USD";

  const fmtMoney = useCallback(
    (value: number) => formatMoney(value, currency, i18n.language),
    [currency, i18n.language]
  );

  const ratingValue = useMemo(() => {
    if (!data?.kpis.rating) return t("common.na");
    const reviews =
      data.kpis.ratingCount > 0
        ? t("restaurant.commandCenter.reviewsCount", { count: data.kpis.ratingCount })
        : "";
    return `★ ${data.kpis.rating}${reviews ? ` ${reviews}` : ""}`;
  }, [data?.kpis.rating, data?.kpis.ratingCount, t]);

  const statusLabel = useCallback(
    (status: string) =>
      t(`restaurant.commandCenter.statusLabels.${status}`, {
        defaultValue: status,
      }),
    [t]
  );

  const trendItems = useMemo(() => {
    if (!data) return [];
    return [
      {
        key: "revenue",
        label: t("restaurant.commandCenter.revenueToday"),
        yesterday: data.kpis.revenueYesterday,
        today: data.kpis.revenueToday,
        format: fmtMoney,
        color: CC.purpleLight,
      },
      {
        key: "orders",
        label: t("restaurant.commandCenter.ordersToday"),
        yesterday: data.kpis.ordersYesterday,
        today: data.kpis.ordersToday,
        format: (value: number) => String(Math.round(value)),
        color: CC.blue,
      },
      {
        key: "customers",
        label: t("restaurant.commandCenter.customersToday"),
        yesterday: data.kpis.customersYesterday,
        today: data.kpis.customersToday,
        format: (value: number) => String(Math.round(value)),
        color: CC.green,
      },
    ];
  }, [data, fmtMoney, t]);

  const onHandOver = useCallback(
    (orderId: string) => {
      navigation.navigate("RestaurantOrderDetails", { orderId });
    },
    [navigation]
  );

  const onViewMap = useCallback((orderId: string) => {
    setMapFocusOrderId(orderId);
  }, []);

  const onViewOrder = useCallback(
    (orderId: string) => {
      navigation.navigate("RestaurantOrderDetails", { orderId });
    },
    [navigation]
  );

  const openHomeMenu = useCallback(() => {
    Alert.alert(t("restaurant.commandCenter.homeMenuTitle", "Restaurant menu"), undefined, [
      {
        text: t("restaurant.commandCenter.liveMapFull", "Map operations"),
        onPress: () => navigation.navigate("RestaurantHome"),
      },
      {
        text: t("restaurant.commandCenter.viewAllOrders", "View all orders"),
        onPress: () => navigation.navigate("RestaurantOrders"),
      },
      {
        text: t("restaurant.menu.title", "Menu"),
        onPress: () => navigation.navigate("RestaurantMenu"),
      },
      {
        text: t("restaurant.financialCenter.title", "Financial center"),
        onPress: () => navigation.navigate("RestaurantFinancialCenter"),
      },
      {
        text: t("restaurant.security.title", "Security"),
        onPress: () => navigation.navigate("RestaurantSecurity"),
      },
      { text: t("common.cancel", "Cancel"), style: "cancel" },
    ]);
  }, [navigation, t]);

  const onToggleOpen = useCallback(() => {
    if (!restaurantUserId || !data) return;
    confirmToggleAvailability({
      restaurantUserId,
      currentlyOpen: isRestaurantOpen,
      onSuccess: (nextOpen) => {
        setIsOpenOverride(nextOpen);
        void refresh();
      },
    });
  }, [confirmToggleAvailability, data, isRestaurantOpen, refresh, restaurantUserId]);

  useEffect(() => {
    if (data?.restaurant.isOpen != null) {
      setIsOpenOverride(null);
    }
  }, [data?.restaurant.isOpen]);

  const averageBasketLabel = useMemo(() => {
    if (data?.kpis.averageBasket == null) return t("common.na");
    return fmtMoney(data.kpis.averageBasket);
  }, [data?.kpis.averageBasket, fmtMoney, t]);

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <RestaurantBrandLoadingState
          variant="card"
          title={t("restaurant.commandCenter.loadingTitle", "Loading Command Center...")}
          subtitle={t(
            "restaurant.commandCenter.loadingSubtitle",
            "Fetching your restaurant data"
          )}
        />
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <View style={styles.center}>
          <View style={styles.errorIconWrap}>
            <Ionicons name="warning-outline" size={40} color={MMD_WHITE} />
          </View>
          <Text style={styles.errorTitle}>
            {t("restaurant.commandCenter.unableToLoad", "Unable to Load")}
          </Text>
          <Text style={styles.errorText}>
            {t(
              "restaurant.commandCenter.loadFailed",
              "Command Center failed to load. Check your connection and try again."
            )}
          </Text>
          <Pressable style={styles.retryBtn} onPress={() => void refresh()}>
            <Text style={styles.retryText}>
              {t("restaurant.commandCenter.retry", "Retry")}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={CC.purpleLight}
          />
        }
      >
        <View style={[styles.headerRow, { flexDirection: rowDirection() }]}>
          <View style={[styles.brandRow, { flexDirection: rowDirection() }]}>
            <Pressable
              onPress={openHomeMenu}
              style={styles.logoBtn}
              accessibilityRole="button"
              accessibilityLabel={t("restaurant.commandCenter.homeMenuTitle", "Restaurant menu")}
            >
              <Image source={MMD_LOGO} style={styles.logo} resizeMode="contain" />
            </Pressable>
            <View style={styles.headerMeta}>
              <Text style={[styles.headerTitle, { textAlign: textAlignStart() }]} numberOfLines={1}>
                {data.restaurant.name}
              </Text>
              <Text style={[styles.headerDate, { textAlign: textAlignStart() }]}>
                {formatDate(new Date(), i18n.language)}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={onToggleOpen}
            disabled={availabilityLoading || !restaurantUserId}
            style={[
              styles.statusPill,
              isRestaurantOpen ? styles.statusOpen : styles.statusClosed,
              availabilityLoading ? styles.statusLoading : null,
            ]}
            accessibilityRole="button"
          >
            <View
              style={[styles.statusDot, isRestaurantOpen ? styles.dotOpen : styles.dotClosed]}
            />
            <Text style={styles.statusText}>
              {availabilityLoading
                ? t("common.loading", "Loading…")
                : isRestaurantOpen
                  ? t("restaurant.commandCenter.open", "Open")
                  : t("restaurant.commandCenter.closed", "Closed")}
            </Text>
          </Pressable>
        </View>

        <Text style={[styles.greeting, { textAlign: textAlignStart() }]} numberOfLines={2}>
          {t("restaurant.commandCenter.greeting")}
        </Text>

        <RevenueHeroCard
          revenueToday={fmtMoney(data.kpis.revenueToday)}
          revenueYesterday={data.kpis.revenueYesterday}
          revenueYesterdayFormatted={fmtMoney(data.kpis.revenueYesterday)}
          revenueTodayRaw={data.kpis.revenueToday}
          changePct={data.kpis.revenueChangePct}
          changeLabel={
            data.kpis.revenueChangePct != null
              ? t("restaurant.commandCenter.changeVsYesterday", {
                  value: `${data.kpis.revenueChangePct >= 0 ? "+" : ""}${data.kpis.revenueChangePct}%`,
                })
              : null
          }
          restaurantName={data.restaurant.name}
          ordersToday={data.kpis.ordersToday}
          activeDrivers={data.map.drivers.length}
          liveAlerts={
            data.liveOperations.driverArrived.length +
            data.liveOperations.driverApproaching.length +
            data.liveOperations.driverEnRoute.length +
            data.liveOperations.newOrders.length +
            data.liveOperations.attentionRequired.length
          }
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.kpiScroll}>
          <View style={[styles.kpiRow, { flexDirection: rowDirection() }]}>
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.ordersToday")}
              value={String(data.kpis.ordersToday)}
              changePct={data.kpis.ordersChangePct}
              sparklineValues={[data.kpis.ordersYesterday, data.kpis.ordersToday]}
              accent="blue"
            />
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.customersToday")}
              value={String(data.kpis.customersToday)}
              changePct={data.kpis.customersChangePct}
              sparklineValues={[data.kpis.customersYesterday, data.kpis.customersToday]}
              accent="green"
            />
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.averageBasket")}
              value={averageBasketLabel}
              changePct={data.kpis.averageBasketChangePct}
              sparklineValues={
                data.kpis.averageBasketYesterday != null && data.kpis.averageBasket != null
                  ? [data.kpis.averageBasketYesterday, data.kpis.averageBasket]
                  : []
              }
              accent="orange"
            />
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.rating")}
              value={ratingValue}
              accent="gold"
            />
          </View>
        </ScrollView>

        <LiveOperationsCenter
          data={data.liveOperations}
          currency={currency}
          language={i18n.language}
          onHandOver={onHandOver}
          onViewMap={onViewMap}
          onViewOrder={onViewOrder}
          onRefresh={() => void refresh()}
        />

        <RestaurantLiveMap
          restaurant={data.restaurant}
          mapData={data.map}
          focusOrderId={mapFocusOrderId}
          height={360}
          onOpenFullMap={() => navigation.navigate("RestaurantHome")}
        />

        <OrderInsightsCard
          orderStatusBreakdown={data.orderStatusBreakdown}
          ordersToday={data.kpis.ordersToday}
          prepTime={data.prepTime}
          statusLabel={statusLabel}
        />

        <View style={styles.trendCard}>
          <RevenueTrendChart items={trendItems} />
        </View>

        <RestaurantAiGrowthManager
          data={aiGrowth}
          language={i18n.language}
          loading={loading}
          onViewInventory={() => navigation.navigate("RestaurantMenu")}
        />

        <TopProductsCard products={data.topProducts} language={i18n.language} loading={loading} />

        <FinancialSummaryCard
          financial={data.financial}
          language={i18n.language}
          onViewFullReport={() => navigation.navigate("RestaurantFinancialCenter")}
        />

        <Pressable
          style={styles.allOrdersBtn}
          onPress={() => navigation.navigate("RestaurantOrders")}
        >
          <Text style={styles.allOrdersText}>
            {t("restaurant.commandCenter.viewAllOrders", "View All Orders")}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: MMD_BLUE,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 48,
    gap: 10,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 32,
  },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  errorTitle: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  errorText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 21,
    marginTop: -20,
  },
  retryBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 12,
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  headerRow: {
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  brandRow: {
    flex: 1,
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  logoBtn: {
    width: 64,
    height: 64,
    borderRadius: 14,
    overflow: "hidden",
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  headerMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  headerDate: {
    color: CC.textMuted,
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
  },
  statusOpen: {
    backgroundColor: CC.greenDim,
    borderColor: "rgba(34,197,94,0.2)",
  },
  statusClosed: {
    backgroundColor: CC.redDim,
    borderColor: "rgba(248,113,113,0.2)",
  },
  statusLoading: {
    opacity: 0.65,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotOpen: {
    backgroundColor: CC.green,
  },
  dotClosed: {
    backgroundColor: CC.red,
  },
  statusText: {
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  greeting: {
    color: CC.textMuted,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  kpiScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  kpiRow: {
    gap: 12,
    paddingRight: 16,
  },
  trendCard: {
    borderRadius: 16,
    padding: 16,
    backgroundColor: CC.glass,
    borderWidth: 1,
    borderColor: CC.glassBorder,
    ...CC.shadow,
  },
  allOrdersBtn: {
    marginTop: 4,
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 14,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  allOrdersText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
});
