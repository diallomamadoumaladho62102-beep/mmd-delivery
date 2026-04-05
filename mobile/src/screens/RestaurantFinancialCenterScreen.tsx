import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

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

function formatMoney(value: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

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
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardValue}>{value}</Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
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
      <Text style={styles.sectionTitle}>{title}</Text>
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
      <View style={styles.chartBarsRow}>
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<FinancialOverview | null>(null);

  const apiBase = useMemo(() => {
    const value = process.env.EXPO_PUBLIC_API_BASE_URL;
    return value?.trim().replace(/\/$/, "") ?? "";
  }, []);

  const loadOverview = async () => {
    try {
      setError(null);

      if (!apiBase) {
        throw new Error(
          "EXPO_PUBLIC_API_BASE_URL manquant dans les variables d’environnement."
        );
      }

      const response = await fetch(
        `${apiBase}/api/restaurant/financial/overview`
      );

      const json = await response.json();

      if (!response.ok || !json?.ok) {
        throw new Error(
          json?.error || "Failed to load restaurant financial overview"
        );
      }

      setOverview(json.data);
    } catch (err: any) {
      setError(err?.message || "Something went wrong");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadOverview();
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <Text style={styles.loadingText}>Loading Financial Center...</Text>
      </View>
    );
  }

  if (error || !overview) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error || "No data available"}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <Text style={styles.headerTitle}>Financial Center</Text>
      <Text style={styles.headerSubtitle}>
        Restaurant revenue, payouts, statements, and taxes
      </Text>

      {!overview.profileComplete && overview.missingFields.length > 0 ? (
        <View style={styles.alertBox}>
          <Text style={styles.alertTitle}>Profile incomplete</Text>
          <Text style={styles.alertText}>
            Missing fields: {overview.missingFields.join(", ")}
          </Text>
        </View>
      ) : null}

      <View style={styles.grid}>
        <KpiCard
          title="Gross Sales"
          value={formatMoney(overview.grossSales, overview.currency)}
        />
        <KpiCard
          title="Commission"
          value={formatMoney(overview.platformCommission, overview.currency)}
          subtitle="Platform fees"
        />
        <KpiCard
          title="Net Revenue"
          value={formatMoney(overview.netRevenue, overview.currency)}
        />
        <KpiCard title="Orders" value={String(overview.totalOrders)} />
      </View>

      <SectionCard title="Earnings Graph">
        <SimpleBarChart data={overview.chart} />
      </SectionCard>

      <SectionCard title="Payouts">
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Pending payout</Text>
          <Text style={styles.value}>
            {formatMoney(overview.pendingPayout, overview.currency)}
          </Text>
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.label}>Last payout</Text>
          <Text style={styles.value}>
            {formatMoney(overview.lastPayoutAmount, overview.currency)}
          </Text>
        </View>

        <View style={styles.rowBetween}>
          <Text style={styles.label}>Last payout date</Text>
          <Text style={styles.value}>{overview.lastPayoutDate || "-"}</Text>
        </View>

        {overview.recentPayouts.map((item) => (
          <View key={item.id} style={styles.listItem}>
            <Text style={styles.listTitle}>
              {formatMoney(item.amount, overview.currency)}
            </Text>
            <Text style={styles.listMeta}>
              {item.status} • {item.date}
            </Text>
          </View>
        ))}
      </SectionCard>

      <SectionCard title="Monthly Statements">
        {overview.recentStatements.length === 0 ? (
          <Text style={styles.emptyText}>No statements available yet.</Text>
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

      <SectionCard title="Tax Documents">
        <Text style={styles.taxText}>
          Your annual tax summary remains available from the Tax Center.
        </Text>
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
    flexDirection: "row",
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
    flexDirection: "row",
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
    flexDirection: "row",
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