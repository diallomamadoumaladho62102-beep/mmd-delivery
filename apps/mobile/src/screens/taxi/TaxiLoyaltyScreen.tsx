import React, { useCallback, useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
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
      Alert.alert("Loyalty", e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD" }}>← Back</Text>
        </TouchableOpacity>

        <Text style={{ color: "#fff", fontSize: 26, fontWeight: "800" }}>
          Taxi loyalty
        </Text>

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
              <Text style={{ color: "#94A3B8" }}>Balance</Text>
              <Text style={{ color: "#F8FAFC", fontSize: 32, fontWeight: "800" }}>
                {balance} pts
              </Text>
              <Text style={{ color: "#CBD5E1", marginTop: 8 }}>
                Tier: {tier.toUpperCase()} • Lifetime: {lifetime}
              </Text>
            </View>

            <Text style={{ color: "#CBD5E1", fontWeight: "700", marginTop: 8 }}>
              History
            </Text>
            {entries.length === 0 ? (
              <Text style={{ color: "#64748B" }}>No loyalty activity yet.</Text>
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
