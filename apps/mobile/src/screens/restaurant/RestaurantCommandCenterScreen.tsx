import React, { useCallback, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { useRestaurantCommandCenter } from "../../features/restaurant/hooks/useRestaurantCommandCenter";
import { RestaurantKpiCard } from "../../features/restaurant/components/RestaurantKpiCard";
import { LiveOperationsCenter } from "../../features/restaurant/components/LiveOperationsCenter";
import { RestaurantLiveMap } from "../../features/restaurant/components/RestaurantLiveMap";
import { RestaurantAiGrowthManager } from "../../features/restaurant/components/RestaurantAiGrowthManager";
import { TopProductsCard } from "../../features/restaurant/components/TopProductsCard";
import { FinancialSummaryCard } from "../../features/restaurant/components/FinancialSummaryCard";
import { RevenueHeroCard } from "../../features/restaurant/components/RevenueHeroCard";
import { RevenueTrendChart } from "../../features/restaurant/components/RevenueTrendChart";
import { OrderInsightsCard } from "../../features/restaurant/components/OrderInsightsCard";
import { CommandCenterSkeleton } from "../../features/restaurant/components/CommandCenterSkeleton";
import { CC } from "../../features/restaurant/components/commandCenterTheme";
import { formatDate, formatMoney } from "../../i18n/formatters";
import { mirrorChevron, rowDirection, textAlignStart } from "../../i18n/rtl";

type Props = NativeStackScreenProps<RootStackParamList, "RestaurantCommandCenter">;

export default function RestaurantCommandCenterScreen({ navigation }: Props) {
  const { t, i18n } = useTranslation();
  const { data, aiGrowth, loading, refreshing, error, refresh } = useRestaurantCommandCenter();
  const [mapFocusOrderId, setMapFocusOrderId] = useState<string | null>(null);

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

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <CommandCenterSkeleton />
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <Text style={styles.errorText}>{t("restaurant.commandCenter.loadFailed")}</Text>
          <Pressable style={styles.retryBtn} onPress={() => void refresh()}>
            <Text style={styles.retryText}>{t("restaurant.commandCenter.retry")}</Text>
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
      <StatusBar barStyle="light-content" />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={CC.purpleLight} />
        }
      >
        <View style={[styles.headerRow, { flexDirection: rowDirection() }]}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>{mirrorChevron("back")}</Text>
          </Pressable>
          <View style={styles.headerMeta}>
            <Text style={[styles.headerTitle, { textAlign: textAlignStart() }]}>
              {t("restaurant.commandCenter.title")}
            </Text>
            <Text style={[styles.headerDate, { textAlign: textAlignStart() }]}>
              {formatDate(new Date(), i18n.language)} • {t("restaurant.commandCenter.today")}
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              data.restaurant.isOpen ? styles.statusOpen : styles.statusClosed,
            ]}
          >
            <View style={[styles.statusDot, data.restaurant.isOpen ? styles.dotOpen : styles.dotClosed]} />
            <Text style={styles.statusText}>
              {data.restaurant.isOpen
                ? t("restaurant.commandCenter.open")
                : t("restaurant.commandCenter.closed")}
            </Text>
          </View>
        </View>

        <Text style={[styles.greeting, { textAlign: textAlignStart() }]}>
          {t("restaurant.commandCenter.greeting")}
        </Text>

        <RevenueHeroCard
          revenueToday={fmtMoney(data.kpis.revenueToday)}
          revenueYesterday={data.kpis.revenueYesterday}
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
              value={fmtMoney(data.kpis.averageBasket)}
              changePct={data.kpis.averageBasketChangePct}
              sparklineValues={[data.kpis.averageBasketYesterday, data.kpis.averageBasket]}
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
          <Text style={styles.allOrdersText}>{t("restaurant.commandCenter.viewAllOrders")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: CC.bg,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 18,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  errorText: {
    color: CC.red,
    textAlign: "center",
    marginBottom: 12,
    fontWeight: "700",
  },
  retryBtn: {
    backgroundColor: CC.purpleGlow,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  retryText: {
    color: CC.purpleLight,
    fontWeight: "900",
  },
  headerRow: {
    alignItems: "center",
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: CC.glass,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CC.glassBorder,
  },
  backText: {
    color: CC.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  headerMeta: {
    flex: 1,
  },
  headerTitle: {
    color: CC.textPrimary,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  headerDate: {
    color: CC.textMuted,
    fontSize: 12,
    marginTop: 3,
    fontWeight: "600",
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  statusOpen: {
    backgroundColor: CC.greenDim,
    borderColor: "rgba(34,197,94,0.35)",
  },
  statusClosed: {
    backgroundColor: CC.redDim,
    borderColor: "rgba(239,68,68,0.35)",
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
    color: CC.textPrimary,
    fontSize: 11,
    fontWeight: "900",
  },
  greeting: {
    color: CC.textSecondary,
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
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
    borderRadius: 20,
    padding: 16,
    backgroundColor: CC.glass,
    borderWidth: 1,
    borderColor: CC.glassBorder,
    ...CC.shadow,
  },
  allOrdersBtn: {
    marginTop: 4,
    backgroundColor: CC.purpleGlow,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: CC.glassBorder,
    ...CC.shadow,
  },
  allOrdersText: {
    color: CC.purpleLight,
    fontWeight: "900",
    fontSize: 15,
  },
});
