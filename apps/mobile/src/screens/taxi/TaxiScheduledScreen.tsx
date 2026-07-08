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
import { formatDateTime } from "../../i18n/formatters";
import { textAlignStart } from "../../i18n/rtl";
import {
  cancelScheduledTaxiRide,
  fetchScheduledTaxiRides,
  formatTaxiCents,
} from "../../lib/taxiClientApi";
import ScreenHeader from "../../components/navigation/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiScheduled">;

export default function TaxiScheduledScreen() {
  const navigation = useNavigation<Nav>();
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchScheduledTaxiRides();
      setItems((res?.items as Record<string, unknown>[]) ?? []);
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.scheduled.title", "Scheduled rides"),
        e instanceof Error ? e.message : t("taxi.scheduled.loadFailed", "Load failed")
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
        title={t("taxi.scheduled.title", "Scheduled rides")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
        <TouchableOpacity
          onPress={() => navigation.navigate("TaxiScheduledBook")}
          style={{
            backgroundColor: "#F59E0B",
            padding: 14,
            borderRadius: 14,
            alignItems: "center",
          }}
        >
          <Text style={{ fontWeight: "800", color: "#111827" }}>
            {t("taxi.scheduled.book", "Book scheduled ride")}
          </Text>
        </TouchableOpacity>
        {loading ? <ActivityIndicator color="#F59E0B" /> : null}
        {items.map((item) => {
          const ride = item.taxi_rides as Record<string, unknown> | undefined;
          const id = String(item.id ?? "");
          return (
            <View
              key={id}
              style={{
                padding: 14,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "#334155",
              }}
            >
              <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                {formatDateTime(String(item.scheduled_pickup_at ?? ""), i18n.language)}
              </Text>
              <Text style={{ color: "#94A3B8", marginTop: 4 }}>
                {String(ride?.pickup_address ?? "")} → {String(ride?.dropoff_address ?? "")}
              </Text>
              <Text style={{ color: "#86EFAC", marginTop: 4 }}>
                {formatTaxiCents(ride?.total_cents, String(ride?.currency ?? "USD"))}
              </Text>
              <TouchableOpacity
                onPress={() =>
                  cancelScheduledTaxiRide(id)
                    .then(load)
                    .catch((e: unknown) =>
                      Alert.alert(
                        t("taxi.scheduled.cancel", "Cancel reservation"),
                        e instanceof Error
                          ? e.message
                          : t("taxi.scheduled.cancelFailed", "Failed")
                      )
                    )
                }
                style={{ marginTop: 8 }}
              >
                <Text style={{ color: "#FCA5A5" }}>
                  {t("taxi.scheduled.cancel", "Cancel reservation")}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}
