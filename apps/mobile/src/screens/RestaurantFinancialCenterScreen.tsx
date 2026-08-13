import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { API_BASE_URL } from "../lib/apiBase";
import { supabase } from "../lib/supabase";
import { formatMoney } from "../i18n/formatters";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../components/restaurant/RestaurantBrandLoadingState";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../theme/mmdUi";

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
};

const CARD_BORDER = "rgba(255,255,255,0.1)";
const MUTED = "rgba(255,255,255,0.7)";
const DEBIT = "#FCA5A5";

/**
 * Figma Lot 5 — 348:7145 Loading / 348:7156 Error / 348:7169 Default.
 * Keeps /api/restaurant/financial/overview RPC.
 */
export default function RestaurantFinancialCenterScreen() {
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
    (value: number, currency = "USD") =>
      formatMoney(value, currency, i18n.language),
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
        }
      );

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(
          json?.error ||
            t(
              "restaurant.financial.loadFailed",
              "Failed to load restaurant financial overview"
            )
        );
      }

      setOverview(json.data as FinancialOverview);
    } catch (err: any) {
      setError(
        err?.message || t("common.somethingWentWrong", "Something went wrong")
      );
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
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader
          title={t("restaurant.financial.title", "Financial Center")}
          subtitle="💰"
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <RestaurantBrandLoadingState
          glass
          title={t(
            "restaurant.financial.loadingTitle",
            "Loading Financials..."
          )}
          subtitle={t(
            "restaurant.financial.loadingSubtitle",
            "Fetching your financial overview"
          )}
        />
      </SafeAreaView>
    );
  }

  if (error || !overview) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScreenHeader
          title={t("restaurant.financial.title", "Financial Center")}
          subtitle="💰"
          fallbackRoute="RestaurantCommandCenter"
          variant="mmd"
        />
        <View style={styles.centered}>
          <View style={styles.errorCard}>
            <View style={styles.iconCircle}>
              <Text style={styles.emoji}>❌</Text>
            </View>
            <Text style={styles.errorTitle}>
              {t("restaurant.financial.errorTitle", "Unable to Load")}
            </Text>
            <Text style={styles.errorBody}>
              {error ||
                t(
                  "restaurant.financial.noData",
                  "Financial overview unavailable. Please try again."
                )}
            </Text>
            <TouchableOpacity
              style={styles.cta}
              onPress={() => {
                setLoading(true);
                void loadOverview();
              }}
              accessibilityRole="button"
            >
              <Text style={styles.ctaLabel}>{t("common.retry", "Retry")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <ScreenHeader
        title={t("restaurant.financial.title", "Financial center")}
        subtitle="💰"
        fallbackRoute="RestaurantCommandCenter"
        variant="mmd"
      />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={MMD_WHITE}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>
            📊 {t("restaurant.financial.overview", "Financial Overview")}
          </Text>
          <Text style={styles.heroBody}>
            {t(
              "restaurant.financial.overviewSubtitle",
              "Net revenue and fees for the selected period."
            )}
          </Text>
        </View>

        <View style={styles.metricCard}>
          <View style={styles.metricIcon}>
            <Text style={styles.metricEmoji}>💵</Text>
          </View>
          <View style={styles.metricText}>
            <Text style={styles.metricLabel}>
              {t("restaurant.financial.grossSales", "Gross Sales")}
            </Text>
            <Text style={styles.metricValue}>
              {fmtMoney(overview.grossSales, overview.currency)}
            </Text>
          </View>
        </View>

        <View style={styles.metricCard}>
          <View style={styles.metricIcon}>
            <Text style={styles.metricEmoji}>📉</Text>
          </View>
          <View style={styles.metricText}>
            <Text style={styles.metricLabel}>
              {t("restaurant.financial.platformFees", "Platform Fees")}
            </Text>
            <Text style={[styles.metricValue, { color: DEBIT }]}>
              −{fmtMoney(overview.platformCommission, overview.currency)}
            </Text>
          </View>
        </View>

        <View style={styles.metricCard}>
          <View style={styles.metricIcon}>
            <Text style={styles.metricEmoji}>💰</Text>
          </View>
          <View style={styles.metricText}>
            <Text style={styles.metricLabel}>
              {t("restaurant.financial.netRevenue", "Net Revenue")}
            </Text>
            <Text style={[styles.metricValueLg, { color: MMD_TAXI_GREEN }]}>
              {fmtMoney(overview.netRevenue, overview.currency)}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
  errorCard: {
    width: "100%",
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 40,
    alignItems: "center",
    gap: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 32, color: MMD_WHITE },
  errorTitle: {
    color: MMD_TEXT,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  errorBody: {
    color: MUTED,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
  cta: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaLabel: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  heroCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 24,
    padding: 24,
    gap: 12,
  },
  heroTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  heroBody: {
    color: MUTED,
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  metricCard: {
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  metricIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: MMD_GLASS,
    alignItems: "center",
    justifyContent: "center",
  },
  metricEmoji: { fontSize: 20, color: MMD_WHITE },
  metricText: { flex: 1, gap: 4 },
  metricLabel: {
    color: MUTED,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  metricValue: {
    color: MMD_WHITE,
    fontSize: 24,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  metricValueLg: {
    color: MMD_WHITE,
    fontSize: 28,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
