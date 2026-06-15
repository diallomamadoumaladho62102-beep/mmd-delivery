import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
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
import { formatDate, formatMoney } from "../../i18n/formatters";
import { mirrorChevron, rowDirection, textAlignStart } from "../../i18n/rtl";

type Props = NativeStackScreenProps<RootStackParamList, "RestaurantCommandCenter">;

function formatChangeLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  pct: number | null | undefined
): string | null {
  if (pct == null || !Number.isFinite(pct)) return null;
  const sign = pct >= 0 ? "+" : "";
  return t("restaurant.commandCenter.changeVsYesterday", {
    value: `${sign}${pct}%`,
  });
}

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
        <View style={styles.center}>
          <ActivityIndicator color="#A78BFA" size="large" />
          <Text style={styles.loadingText}>{t("restaurant.commandCenter.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="light-content" />
        <View style={styles.center}>
          <Text style={styles.errorText}>{t("restaurant.commandCenter.loadFailed")}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void refresh()}>
            <Text style={styles.retryText}>{t("restaurant.commandCenter.retry")}</Text>
          </TouchableOpacity>
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
          <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor="#A78BFA" />
        }
      >
        <View style={[styles.headerRow, { flexDirection: rowDirection() }]}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>{mirrorChevron("back")}</Text>
          </TouchableOpacity>
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

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.kpiScroll}>
          <View style={[styles.kpiRow, { flexDirection: rowDirection() }]}>
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.revenueToday")}
              value={fmtMoney(data.kpis.revenueToday)}
              changeLabel={formatChangeLabel(t, data.kpis.revenueChangePct)}
              accent="purple"
            />
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.ordersToday")}
              value={String(data.kpis.ordersToday)}
              changeLabel={formatChangeLabel(t, data.kpis.ordersChangePct)}
              accent="blue"
            />
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.customersToday")}
              value={String(data.kpis.customersToday)}
              changeLabel={formatChangeLabel(t, data.kpis.customersChangePct)}
              accent="green"
            />
            <RestaurantKpiCard
              title={t("restaurant.commandCenter.averageBasket")}
              value={fmtMoney(data.kpis.averageBasket)}
              changeLabel={formatChangeLabel(t, data.kpis.averageBasketChangePct)}
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

        <Text style={[styles.sectionTitle, { textAlign: textAlignStart() }]}>
          {t("restaurant.commandCenter.liveMap")}
        </Text>
        <RestaurantLiveMap
          restaurant={data.restaurant}
          mapData={data.map}
          focusOrderId={mapFocusOrderId}
        />

        <View style={styles.splitRow}>
          <View style={styles.splitCol}>
            <Text style={[styles.sectionTitle, { textAlign: textAlignStart() }]}>
              {t("restaurant.commandCenter.ordersOverview")}
            </Text>
            {data.orderStatusBreakdown.length === 0 ? (
              <Text style={styles.muted}>{t("restaurant.commandCenter.liveOperationsEmpty")}</Text>
            ) : (
              data.orderStatusBreakdown.map((slice) => (
                <View key={slice.status} style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>{statusLabel(slice.status)}</Text>
                  <Text style={styles.breakdownValue}>
                    {slice.count} ({slice.pct}%)
                  </Text>
                </View>
              ))
            )}
          </View>

          <View style={styles.splitCol}>
            <Text style={[styles.sectionTitle, { textAlign: textAlignStart() }]}>
              {t("restaurant.commandCenter.prepTime")}
            </Text>
            <Text style={styles.prepValue}>
              {data.prepTime.averageMinutes != null
                ? t("restaurant.commandCenter.minutesUnit", {
                    value: data.prepTime.averageMinutes,
                  })
                : t("common.na")}
            </Text>
            <Text style={styles.muted}>
              {t("restaurant.commandCenter.prepTimeTarget", {
                minutes: data.prepTime.targetMinutes,
              })}
            </Text>
            {data.prepTime.percentileBetterThan != null ? (
              <Text style={styles.prepGood}>
                {t("restaurant.commandCenter.prepTimeGood", {
                  percent: data.prepTime.percentileBetterThan,
                })}
              </Text>
            ) : null}
          </View>
        </View>

        <RestaurantAiGrowthManager
          data={aiGrowth}
          language={i18n.language}
          loading={loading}
          onViewInventory={() => navigation.navigate("RestaurantMenu")}
        />

        <TopProductsCard
          products={data.topProducts}
          language={i18n.language}
          loading={loading}
        />

        <FinancialSummaryCard
          financial={data.financial}
          language={i18n.language}
          onViewFullReport={() => navigation.navigate("RestaurantFinancialCenter")}
        />

        <TouchableOpacity
          style={styles.allOrdersBtn}
          onPress={() => navigation.navigate("RestaurantOrders")}
        >
          <Text style={styles.allOrdersText}>{t("restaurant.commandCenter.viewAllOrders")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#020617",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
    gap: 18,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    color: "rgba(148,163,184,0.95)",
    marginTop: 12,
  },
  errorText: {
    color: "#FCA5A5",
    textAlign: "center",
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: "rgba(124,58,237,0.35)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryText: {
    color: "#DDD6FE",
    fontWeight: "800",
  },
  headerRow: {
    alignItems: "center",
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  backText: {
    color: "#F8FAFC",
    fontSize: 18,
    fontWeight: "900",
  },
  headerMeta: {
    flex: 1,
  },
  headerTitle: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "900",
  },
  headerDate: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 12,
    marginTop: 2,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusOpen: {
    backgroundColor: "rgba(34,197,94,0.2)",
  },
  statusClosed: {
    backgroundColor: "rgba(239,68,68,0.18)",
  },
  statusText: {
    color: "#F8FAFC",
    fontSize: 11,
    fontWeight: "800",
  },
  greeting: {
    color: "rgba(226,232,240,0.88)",
    fontSize: 14,
    lineHeight: 20,
  },
  kpiScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  kpiRow: {
    gap: 10,
    paddingRight: 16,
  },
  sectionTitle: {
    color: "#F8FAFC",
    fontSize: 17,
    fontWeight: "900",
    marginBottom: 8,
  },
  splitRow: {
    flexDirection: "row",
    gap: 12,
  },
  splitCol: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.15)",
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  breakdownLabel: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 12,
    textTransform: "capitalize",
  },
  breakdownValue: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
  },
  prepValue: {
    color: "#A78BFA",
    fontSize: 28,
    fontWeight: "900",
  },
  prepGood: {
    color: "#4ADE80",
    fontSize: 11,
    marginTop: 8,
    fontWeight: "700",
  },
  muted: {
    color: "rgba(148,163,184,0.95)",
    fontSize: 12,
  },
  allOrdersBtn: {
    marginTop: 4,
    backgroundColor: "rgba(124,58,237,0.35)",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
  },
  allOrdersText: {
    color: "#DDD6FE",
    fontWeight: "900",
    fontSize: 14,
  },
});
