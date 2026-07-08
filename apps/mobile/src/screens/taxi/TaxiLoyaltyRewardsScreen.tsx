import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
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
  fetchTaxiLoyaltyRewards,
  formatTaxiCents,
} from "../../lib/taxiClientApi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiLoyaltyRewards">;

type Reward = {
  id: string;
  title: string;
  description?: string | null;
  points_cost: number;
  discount_cents: number;
};

export default function TaxiLoyaltyRewardsScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rewardsRes, balanceRes] = await Promise.all([
        fetchTaxiLoyaltyRewards(),
        fetchTaxiLoyaltyBalance(),
      ]);
      setRewards((rewardsRes?.rewards as Reward[]) ?? []);
      setBalance(Number(balanceRes?.account?.points_balance ?? 0));
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.loyaltyRewards.title", "Loyalty rewards"),
        e instanceof Error ? e.message : t("taxi.loyaltyRewards.loadFailed", "Load failed")
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
      <ScreenHeader
        title={t("taxi.loyaltyRewards.title", "Loyalty rewards")}
        subtitle={t("taxi.loyaltyRewards.balancePts", "Balance: {{count}} pts", { count: balance })}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        {loading ? <ActivityIndicator color="#F59E0B" /> : null}
        {rewards.map((reward) => (
          <View
            key={reward.id}
            style={{
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#334155",
            }}
          >
            <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>{reward.title}</Text>
            {reward.description ? (
              <Text style={{ color: "#94A3B8", marginTop: 4 }}>{reward.description}</Text>
            ) : null}
            <Text style={{ color: "#86EFAC", marginTop: 6 }}>
              {reward.points_cost} pts → {formatTaxiCents(reward.discount_cents)}
            </Text>
            <Text style={{ color: "#64748B", marginTop: 6 }}>
              {t(
                "taxi.loyaltyRewards.applyOnQuote",
                "Apply on the quote screen before checkout."
              )}
            </Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
