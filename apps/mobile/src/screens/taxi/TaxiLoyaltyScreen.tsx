import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
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

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiLoyalty">;

type LedgerEntry = {
  id: string;
  delta_points: number;
  balance_after: number;
  entry_type: string;
  description: string | null;
  created_at: string;
};

export default function TaxiLoyaltyScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const [balance, setBalance] = useState(0);
  const [tier, setTier] = useState("bronze");
  const [lifetime, setLifetime] = useState(0);
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
      setEntries((historyRes?.entries as LedgerEntry[]) ?? []);
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.loyalty.title", "Taxi loyalty"),
        e instanceof Error ? e.message : t("taxi.loyalty.loadFailed", "Load failed")
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("taxi.loyalty.title", "Taxi loyalty")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        {loading ? (
          <ActivityIndicator color="#F59E0B" />
        ) : (
          <>
            <View
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: "rgba(15,23,42,0.95)",
                borderWidth: 1,
                borderColor: "#334155",
              }}
            >
              <Text style={{ color: "#94A3B8" }}>{t("taxi.loyalty.balance", "Balance")}</Text>
              <Text style={{ color: "#F8FAFC", fontSize: 32, fontWeight: "800" }}>
                {balance} pts
              </Text>
              <Text style={{ color: "#CBD5E1", marginTop: 8 }}>
                {t("taxi.loyalty.tier", "Tier: {{tier}} • Lifetime: {{lifetime}}", {
                  tier: tier.toUpperCase(),
                  lifetime,
                })}
              </Text>
            </View>

            <Text style={{ color: "#CBD5E1", fontWeight: "700", marginTop: 8, textAlign: textAlignStart() }}>
              {t("taxi.loyalty.history", "History")}
            </Text>
            {entries.length === 0 ? (
              <Text style={{ color: "#64748B" }}>
                {t("taxi.loyalty.noActivity", "No loyalty activity yet.")}
              </Text>
            ) : (
              entries.map((entry) => (
                <View
                  key={entry.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#334155",
                  }}
                >
                  <Text style={{ color: "#E2E8F0", fontWeight: "700" }}>
                    {entry.delta_points > 0 ? "+" : ""}
                    {entry.delta_points} pts
                  </Text>
                  <Text style={{ color: "#94A3B8" }}>
                    {entry.description ?? entry.entry_type}
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
