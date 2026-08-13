import React, { useCallback, useEffect, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { textAlignStart } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  fetchTaxiLoyaltyBalance,
  fetchTaxiLoyaltyHistory,
} from "../../lib/taxiClientApi";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiLoyalty">;

type LedgerEntry = {
  id: string;
  delta_points: number;
  balance_after: number;
  entry_type: string;
  description: string | null;
  created_at: string;
};

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

export default function TaxiLoyaltyScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const [balance, setBalance] = useState(0);
  const [tier, setTier] = useState("bronze");
  const [lifetime, setLifetime] = useState(0);
  const [completedRides, setCompletedRides] = useState(0);
  const [avgDriverRating, setAvgDriverRating] = useState<number | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [balanceRes, historyRes] = await Promise.all([
        fetchTaxiLoyaltyBalance(),
        fetchTaxiLoyaltyHistory(),
      ]);
      const account = balanceRes?.account as Record<string, unknown> | undefined;
      setBalance(Number(account?.points_balance ?? 0));
      setTier(String(account?.tier ?? "bronze"));
      setLifetime(Number(account?.lifetime_points ?? 0));
      setCompletedRides(Number(account?.completed_rides ?? 0));
      const rawRating = account?.avg_driver_rating;
      const parsed =
        rawRating == null || rawRating === ""
          ? null
          : Number(rawRating);
      setAvgDriverRating(
        parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null
      );
      setEntries((historyRes?.entries as LedgerEntry[]) ?? []);
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.loyalty.title", "Taxi loyalty"),
        toUserFacingError(e, t("taxi.loyalty.loadFailed", "Load failed"))
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("taxi.loyalty.title", "Loyalty Program")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Image
          source={MMD_LOGO}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel="MMD Delivery"
        />
        <Text style={styles.brand}>MMD Delivery</Text>

        {loading ? (
          <ActivityIndicator color={MMD_GOLD_CLASSIC} />
        ) : (
          <>
            <View style={styles.balanceCard}>
              <Text style={styles.balanceLabel}>
                {t("taxi.loyalty.balance", "Balance")}
              </Text>
              <Text style={styles.balanceValue}>{balance} pts</Text>
              <Text style={styles.balanceMeta}>
                {t("taxi.loyalty.tier", "Tier: {{tier}} • Lifetime: {{lifetime}}", {
                  tier: tier.toUpperCase(),
                  lifetime,
                })}
              </Text>
            </View>

            <Text style={[styles.historyTitle, { textAlign: textAlignStart() }]}>
              {t("taxi.loyalty.history", "History")}
            </Text>
            {entries.length === 0 ? (
              <Text style={styles.empty}>
                {t("taxi.loyalty.noActivity", "No loyalty activity yet.")}
              </Text>
            ) : (
              entries.map((entry) => (
                <View key={entry.id} style={styles.historyRow}>
                  <Text style={styles.historyPts}>
                    {entry.delta_points > 0 ? "+" : ""}
                    {entry.delta_points} pts
                  </Text>
                  <Text style={styles.historyDesc}>
                    {entry.description ?? entry.entry_type}
                  </Text>
                </View>
              ))
            )}

            <View style={styles.divider} />

            <View style={styles.ratingSection}>
              <Text style={styles.ratingTitle}>
                {t("taxi.loyalty.driverRating", "Driver Rating")}
              </Text>
              {avgDriverRating != null && completedRides > 0 ? (
                <>
                  <Text style={styles.ratingValue}>
                    {avgDriverRating.toFixed(1)}
                  </Text>
                  <Text style={styles.ratingStars}>
                    {"★".repeat(Math.min(5, Math.round(avgDriverRating)))}
                    {"☆".repeat(Math.max(0, 5 - Math.min(5, Math.round(avgDriverRating))))}
                  </Text>
                  <Text style={styles.ratingMeta}>
                    {t("taxi.loyalty.basedOnRides", "Based on {{count}} rides", {
                      count: completedRides,
                    })}
                  </Text>
                </>
              ) : (
                <Text style={styles.ratingEmpty}>
                  {t(
                    "taxi.loyalty.ratingEmpty",
                    "Complete taxi rides to see your drivers’ average rating."
                  )}
                </Text>
              )}
              <View style={styles.tierBadge}>
                <Text style={styles.tierStar}>★</Text>
                <Text style={styles.tierLabel}>
                  {tier.toUpperCase()} MEMBER
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 10,
    alignItems: "center",
  },
  logo: { width: 56, height: 56, borderRadius: 28 },
  brand: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 16,
    textAlign: "center",
  },
  balanceCard: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: MMD_GOLD_CLASSIC,
    backgroundColor: "rgba(0,51,153,0.95)",
    alignItems: "center",
    gap: 8,
  },
  balanceLabel: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    textAlign: "center",
    width: "100%",
  },
  balanceValue: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 32,
    fontWeight: "800",
    textAlign: "center",
    width: "100%",
  },
  balanceMeta: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
    textAlign: "center",
    width: "100%",
  },
  historyTitle: {
    color: "#CBD5E1",
    fontFamily: MMD_FONT.bold,
    fontSize: 15,
    fontWeight: "700",
    width: "100%",
    textAlign: "center",
  },
  empty: { color: MMD_TEXT_MUTED_BLUE, width: "100%" },
  historyRow: {
    width: "100%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    gap: 4,
  },
  historyPts: {
    color: "#E2E8F0",
    fontFamily: MMD_FONT.bold,
    fontSize: 15,
    fontWeight: "700",
  },
  historyDesc: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  divider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    backgroundColor: MMD_STROKE,
    marginVertical: 4,
  },
  ratingSection: {
    width: "100%",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 16,
    gap: 8,
  },
  ratingTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.semibold,
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  ratingValue: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 40,
    fontWeight: "800",
    textAlign: "center",
  },
  ratingStars: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 22,
    letterSpacing: 4,
    textAlign: "center",
  },
  ratingMeta: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
    textAlign: "center",
  },
  ratingEmpty: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: 12,
    marginBottom: 4,
  },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: MMD_GOLD_CLASSIC,
    marginTop: 8,
    backgroundColor: "rgba(212,175,55,0.15)",
  },
  tierStar: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 16,
  },
  tierLabel: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontSize: 14,
    fontWeight: "700",
  },
});
