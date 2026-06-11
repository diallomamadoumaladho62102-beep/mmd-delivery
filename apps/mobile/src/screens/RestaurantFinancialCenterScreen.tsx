import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "../lib/apiBase";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { formatMoney, formatDateTime } from "../i18n/formatters";
import { rowDirection, textAlignStart, mirrorChevron } from "../i18n/rtl";

type ChartPoint = {
  label: string;
  gross: number;
  net: number;
};

type StatementItem = {
  id: string;
  label: string;
  status: string;
  type: string;
};

type PayoutItem = {
  id: string;
  amount: number;
  status: string;
  date: string;
};

type FinancialOverview = {
  currency: string;
  grossSales: number;
  platformCommission: number;
  netRevenue: number;
  totalOrders: number;
  pendingPayout: number;
  lastPayoutAmount: number;
  lastPayoutDate: string | null;
  profileComplete: boolean;
  missingFields: string[];
  chart: ChartPoint[];
  recentStatements: StatementItem[];
  recentPayouts: PayoutItem[];
};

function KpiCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={[styles.cardTitle, { textAlign: textAlignStart() }]}>{title}</Text>
      <Text style={[styles.cardValue, { textAlign: textAlignStart() }]}>{value}</Text>
      {subtitle ? (
        <Text style={[styles.cardSubtitle, { textAlign: textAlignStart() }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.sectionCard}>
      <Text style={[styles.sectionTitle, { textAlign: textAlignStart() }]}>{title}</Text>
      {children}
    </View>
  );
}

function SimpleBarChart({ data }: { data: ChartPoint[] }) {
  const maxGross = useMemo(() => {
    if (!data.length) return 1;
    return Math.max(...data.map((item) => item.gross), 1);
  }, [data]);

  return (
    <View style={styles.chartContainer}>
      <View style={[styles.chartBarsRow, { flexDirection: rowDirection() }]}>
        {data.map((item) => {
          const height = (item.gross / maxGross) * 140;

          return (
            <View key={item.label} style={styles.barItem}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height }]} />
              </View>
              <Text style={styles.barLabel}>{item.label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function RestaurantFinancialCenterScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<FinancialOverview | null>(null);

  const apiBase = useMemo(() => {
    const value = String(API_BASE_URL ?? "").trim();
    return value ? value.replace(/\/+$/, "") : "";
  }, []);

  const fmtMoney = useCallback(
    (value: number, currency = "USD") => formatMoney(value, currency, i18n.language),
    [i18n.language]
  );

  const loadOverview = useCallback(async () => {
    try {
      setError(null);

      if (!apiBase) {
        throw new Error(
          t(
            "restaurant.financial.apiMissing",
            "API_BASE_URL is missing. Check your production API configuration."
          )
        );
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const accessToken = session?.access_token?.trim();
      if (!accessToken) {
        throw new Error(
          t(
            "restaurant.financial.sessionExpired",
            "Session expired. Sign in again to view the financial center."
          )
        );
      }

      const response = await fetch(
        `${apiBase}/api/restaurant/financial/overview`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(
          json?.error ||
            t("restaurant.financial.loadFailed", "Failed to load restaurant financial overview")
        );
      }

      setOverview(json.data as FinancialOverview);
    } catch (err: any) {
      setError(err?.message || t("common.somethingWentWrong", "Something went wrong"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiBase, t]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOverview();
  }, [loadOverview]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>
            {t("restaurant.financial.loading", "Loading financial center...")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !overview) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>
              {mirrorChevron("back")} {t("common.back", "Back")}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            {error ||
              t(
                "restaurant.financial.noData",
                "No financial data available at the moment."
              )}
          </Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void loadOverview()}>
            <Text style={styles.retryBtnText}>{t("common.retry", "Retry")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>
            {mirrorChevron("back")} {t("common.back", "Back")}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.headerTitle, { textAlign: textAlignStart() }]}>
        {t("restaurant.financial.title", "Financial Center")}
      </Text>
      <Text style={[styles.headerSubtitle, { textAlign: textAlignStart() }]}>
        {t(
          "restaurant.financial.subtitle",
          "Restaurant revenue, payouts, statements, and taxes"
        )}
      </Text>

      {!overview.profileComplete && overview.missingFields.length > 0 ? (
        <View style={styles.alertBox}>
          <Text style={[styles.alertTitle, { textAlign: textAlignStart() }]}>
            {t("restaurant.financial.profileIncomplete", "Profile incomplete")}
          </Text>
          <Text style={[styles.alertText, { textAlign: textAlignStart() }]}>
            {t("restaurant.financial.missingFields", "Missing fields: {{fields}}", {
              fields: overview.missingFields.join(", "),
            })}
          </Text>
        </View>
      ) : null}

      <View style={[styles.grid, { flexDirection: rowDirection() }]}>
        <KpiCard
          title={t("restaurant.financial.grossSales", "Gross Sales")}
          value={fmtMoney(overview.grossSales, overview.currency)}
        />

        <KpiCard
          title={t("restaurant.financial.commission", "Commission")}
          value={fmtMoney(overview.platformCommission, overview.currency)}
          subtitle={t("restaurant.financial.platformFees", "Platform fees")}
        />

        <KpiCard
          title={t("restaurant.financial.netRevenue", "Net Revenue")}
          value={fmtMoney(overview.netRevenue, overview.currency)}
        />

        <KpiCard
          title={t("restaurant.financial.orders", "Orders")}
          value={String(overview.totalOrders)}
        />
      </View>

      <SectionCard title={t("restaurant.financial.earningsGraph", "Earnings Graph")}>
        <SimpleBarChart data={overview.chart} />
      </SectionCard>

      <SectionCard title={t("restaurant.financial.payouts", "Payouts")}>
        <View style={[styles.rowBetween, { flexDirection: rowDirection() }]}>
          <Text style={styles.label}>
            {t("restaurant.financial.pendingPayout", "Pending payout")}
          </Text>
          <Text style={styles.value}>
            {fmtMoney(overview.pendingPayout, overview.currency)}
          </Text>
        </View>

        <View style={[styles.rowBetween, { flexDirection: rowDirection() }]}>
          <Text style={styles.label}>
            {t("restaurant.financial.lastPayout", "Last payout")}
          </Text>
          <Text style={styles.value}>
            {fmtMoney(overview.lastPayoutAmount, overview.currency)}
          </Text>
        </View>

        <View style={[styles.rowBetween, { flexDirection: rowDirection() }]}>
          <Text style={styles.label}>
            {t("restaurant.financial.lastPayoutDate", "Last payout date")}
          </Text>
          <Text style={styles.value}>
            {overview.lastPayoutDate
              ? formatDateTime(overview.lastPayoutDate, i18n.language)
              : t("common.dash", "-")}
          </Text>
        </View>

        {overview.recentPayouts.map((item) => (
          <View key={item.id} style={styles.listItem}>
            <Text style={styles.listTitle}>
              {fmtMoney(item.amount, overview.currency)}
            </Text>
            <Text style={styles.listMeta}>
              {item.status} • {item.date}
            </Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard title={t("restaurant.financial.monthlyStatements", "Monthly Statements")}>
        {overview.recentStatements.length === 0 ? (
          <Text style={styles.emptyText}>
            {t("restaurant.financial.noStatements", "No statements available yet.")}
          </Text>
        ) : (
          overview.recentStatements.map((item) => (
            <View key={item.id} style={styles.listItem}>
              <Text style={styles.listTitle}>{item.label}</Text>
              <Text style={styles.listMeta}>
                {item.type} • {item.status}
              </Text>
            </View>
          ))
        )}
      </SectionCard>

      <SectionCard title={t("restaurant.financial.taxDocuments", "Tax Documents")}>
        <Text style={[styles.taxText, { textAlign: textAlignStart() }]}>
          {t(
            "restaurant.financial.taxSummaryNote",
            "Your annual tax summary remains available from the Tax Center."
          )}
        </Text>
      </SectionCard>
    </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F6F7FB",
  },
  topBar: {
    marginBottom: 8,
  },
  backBtn: {
    alignSelf: "flex-start",
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  backBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#2563EB",
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: "#111827",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryBtnText: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 14,
  },
  container: {
    flex: 1,
    backgroundColor: "#F6F7FB",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: "#666",
  },
  errorText: {
    fontSize: 14,
    color: "#B00020",
    textAlign: "center",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: "#6B7280",
    marginBottom: 16,
  },
  alertBox: {
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FDBA74",
    borderRadius: 14,
    padding: 14,
    marginBottom: 16,
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#9A3412",
    marginBottom: 4,
  },
  alertText: {
    fontSize: 13,
    color: "#9A3412",
  },
  grid: {
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  card: {
    width: "48%",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 13,
    color: "#6B7280",
    marginBottom: 8,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  cardSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#9CA3AF",
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 14,
  },
  chartContainer: {
    paddingTop: 8,
  },
  chartBarsRow: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 180,
  },
  barItem: {
    alignItems: "center",
    flex: 1,
  },
  barTrack: {
    width: 24,
    height: 140,
    backgroundColor: "#E5E7EB",
    borderRadius: 999,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  barFill: {
    width: "100%",
    backgroundColor: "#111827",
    borderRadius: 999,
  },
  barLabel: {
    marginTop: 8,
    fontSize: 12,
    color: "#6B7280",
  },
  rowBetween: {
    justifyContent: "space-between",
    marginBottom: 10,
  },
  label: {
    fontSize: 14,
    color: "#6B7280",
  },
  value: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  listItem: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  listTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  listMeta: {
    marginTop: 4,
    fontSize: 12,
    color: "#6B7280",
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
  },
  taxText: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 20,
  },
});
