import React, { useCallback, useEffect, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  fetchTaxiLoyaltyBalance,
  fetchTaxiLoyaltyRewards,
  formatTaxiCents,
} from "../../lib/taxiClientApi";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GREEN_SOFT,
  MMD_LINK_BLUE,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
} from "../../theme/mmdUi";

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
        toUserFacingError(e, t("taxi.loyaltyRewards.loadFailed", "Load failed"))
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
        title={t("taxi.loyaltyRewards.title", "Loyalty rewards")}
        subtitle={t("taxi.loyaltyRewards.balancePts", "Balance: {{count}} pts", {
          count: balance,
        })}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? <ActivityIndicator color={MMD_GREEN_SOFT} /> : null}
        {rewards.map((reward) => (
          <View key={reward.id} style={styles.card}>
            <Text style={styles.title}>{reward.title}</Text>
            {reward.description ? (
              <Text style={styles.desc}>{reward.description}</Text>
            ) : null}
            <Text style={styles.cost}>
              {reward.points_cost} pts → {formatTaxiCents(reward.discount_cents)}
            </Text>
            <Text style={styles.hint}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: { padding: 20, gap: 12 },
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    gap: 6,
  },
  title: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.bold,
    fontSize: 15,
    fontWeight: "700",
  },
  desc: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  cost: {
    color: "#86EFAC",
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
    fontWeight: "600",
  },
  hint: {
    color: MMD_LINK_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
  },
});
