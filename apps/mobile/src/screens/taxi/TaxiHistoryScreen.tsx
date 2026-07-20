import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { fetchMyTaxiRides, formatTaxiCents } from "../../lib/taxiClientApi";
import { textAlignStart } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiHistory">;

export default function TaxiHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const [rides, setRides] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchMyTaxiRides();
      setRides((result?.rides as Record<string, unknown>[]) ?? []);
    } catch (e) {
      console.log("[TaxiHistory]", e);
      setRides([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" />
      <ScreenHeader
        title={t("taxi.history.title", "Taxi history")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <View style={{ padding: 16, flex: 1 }}>
        {loading ? (
          <ActivityIndicator color="#F59E0B" style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            data={rides}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingTop: 16, gap: 10 }}
            ListEmptyComponent={
              <Text style={{ color: "#94A3B8", marginTop: 20, textAlign: textAlignStart() }}>
                {t("taxi.history.empty", "No taxi rides yet.")}
              </Text>
            }
            renderItem={({ item }) => {
              const rideId = String(item.id);
              const active = !["completed", "canceled"].includes(
                String(item.status ?? "").toLowerCase()
              );
              const plate = String(
                item.vehicle_plate ?? item.vehicle_plate_snapshot ?? "",
              ).trim();
              const label = String(item.vehicle_label ?? "").trim();

              return (
                <TouchableOpacity
                  onPress={() =>
                    navigation.navigate("TaxiRideTracking", { rideId })
                  }
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    backgroundColor: "rgba(15,23,42,0.95)",
                    borderWidth: 1,
                    borderColor: "#334155",
                  }}
                >
                  <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
                    {String(item.status ?? "ride").replace(/_/g, " ")}
                  </Text>
                  <Text style={{ color: "#94A3B8", marginTop: 4 }} numberOfLines={1}>
                    {String(item.pickup_address ?? "")} →{" "}
                    {String(item.dropoff_address ?? "")}
                  </Text>
                  {label || plate ? (
                    <Text style={{ color: "#FBBF24", marginTop: 6, fontWeight: "700" }}>
                      {label || "—"}
                      {plate ? ` · ${plate}` : ""}
                    </Text>
                  ) : null}
                  <Text style={{ color: "#FDE68A", marginTop: 6, fontWeight: "700" }}>
                    {formatTaxiCents(item.total_cents, String(item.currency ?? "USD"))}
                  </Text>
                  {active ? (
                    <Text style={{ color: "#86EFAC", marginTop: 4, fontSize: 12 }}>
                      {t("taxi.history.tapToTrack", "Tap to track")}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
