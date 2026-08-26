import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StatusBar,
  FlatList,
  ActivityIndicator,
  Image,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { fetchMyTaxiRides, formatTaxiCents } from "../../lib/taxiClientApi";
import { textAlignStart } from "../../i18n/rtl";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { ClientServiceBottomNav } from "../../components/navigation/ClientServiceBottomNav";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_TAXI_GREEN,
  MMD_WHITE,
  mmdLogoSizeCompact,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiHistory">;

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

function statusMeta(status: string) {
  const s = status.toLowerCase();
  if (s === "completed") {
    return { color: MMD_TAXI_GREEN, labelKey: "completed" as const };
  }
  if (s === "canceled" || s === "cancelled") {
    return { color: "#DC2626", labelKey: "cancelled" as const };
  }
  return { color: "#3B82F6", labelKey: "inProgress" as const };
}

export default function TaxiHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const logoSize = mmdLogoSizeCompact(width, height);
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

  const totalSpent = useMemo(() => {
    return rides.reduce((sum, item) => {
      const status = String(item.status ?? "").toLowerCase();
      if (status === "canceled" || status === "cancelled") return sum;
      return sum + Math.max(0, Math.round(Number(item.total_cents ?? 0)));
    }, 0);
  }, [rides]);

  const currency = String(rides[0]?.currency ?? "USD");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: MMD_BLUE }} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("taxi.history.title", "Ride History")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <View style={{ padding: 16, flex: 1 }}>
        {loading ? (
          <ActivityIndicator color={MMD_TAXI_GREEN} style={{ marginTop: 24 }} />
        ) : (
          <FlatList
            data={rides}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ paddingTop: 8, gap: 12, paddingBottom: 120 }}
            ListEmptyComponent={
              <View style={{ alignItems: "center", marginTop: 80, gap: 16, paddingHorizontal: 24 }}>
                <Image
                  source={MMD_LOGO}
                  style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
                  resizeMode="contain"
                  accessibilityLabel="MMD"
                />
                <Text
                  style={{
                    color: MMD_WHITE,
                    fontSize: 28,
                    fontWeight: "800",
                    fontFamily: MMD_FONT.extrabold,
                    textAlign: "center",
                  }}
                >
                  {t("taxi.history.emptyTitle", "No rides yet")}
                </Text>
                <Text
                  style={{
                    color: "rgba(255,255,255,0.7)",
                    fontSize: 16,
                    fontFamily: MMD_FONT.regular,
                    textAlign: "center",
                  }}
                >
                  {t("taxi.history.empty", "Your completed rides will appear here.")}
                </Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate("TaxiHome")}
                  style={{
                    marginTop: 8,
                    backgroundColor: MMD_TAXI_GREEN,
                    borderRadius: 16,
                    paddingVertical: 16,
                    paddingHorizontal: 28,
                  }}
                >
                  <Text
                    style={{
                      color: MMD_WHITE,
                      fontWeight: "800",
                      fontFamily: MMD_FONT.extrabold,
                      fontSize: 16,
                    }}
                  >
                    {t("taxi.history.bookFirst", "Book your first ride")}
                  </Text>
                </TouchableOpacity>
              </View>
            }
            ListFooterComponent={
              rides.length > 0 ? (
                <View
                  style={{
                    marginTop: 12,
                    padding: 16,
                    borderRadius: 20,
                    backgroundColor: MMD_GLASS,
                    borderWidth: 1,
                    borderColor: "rgba(212,175,55,0.3)",
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.6)",
                      fontSize: 14,
                      fontFamily: MMD_FONT.regular,
                    }}
                  >
                    {t("taxi.history.totalRides", "Total rides: {{count}}", {
                      count: rides.length,
                    })}
                  </Text>
                  <Text
                    style={{
                      color: MMD_WHITE,
                      fontSize: 14,
                      fontWeight: "700",
                      fontFamily: MMD_FONT.bold,
                    }}
                  >
                    {t("taxi.history.totalSpent", "Total spent: {{amount}}", {
                      amount: formatTaxiCents(totalSpent, currency),
                    })}
                  </Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => {
              const rideId = String(item.id);
              const status = String(item.status ?? "").toLowerCase();
              const completed = status === "completed";
              const cancelled = status === "canceled" || status === "cancelled";
              const active = !completed && !cancelled;
              const plate = String(
                item.vehicle_plate ?? item.vehicle_plate_snapshot ?? "",
              ).trim();
              const label = String(item.vehicle_label ?? "").trim();
              const meta = statusMeta(status);
              const statusLabel =
                meta.labelKey === "completed"
                  ? t("taxi.history.statusCompleted", "Completed")
                  : meta.labelKey === "cancelled"
                    ? t("taxi.history.statusCancelled", "Cancelled")
                    : t("taxi.history.statusInProgress", "In progress");

              return (
                <TouchableOpacity
                  onPress={() => {
                    if (completed) {
                      navigation.navigate("TaxiReceipt", { rideId });
                    } else {
                      navigation.navigate("TaxiRideTracking", { rideId });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={
                    completed
                      ? t("taxi.receipt.view", "View receipt")
                      : ["unpaid", "pending_payment", "processing"].includes(
                            String(item.payment_status ?? "").toLowerCase(),
                          )
                        ? t("taxi.history.tapToPay", "Tap to complete payment")
                        : t("taxi.history.tapToTrack", "Tap to track")
                  }
                  style={{
                    padding: 16,
                    borderRadius: 20,
                    backgroundColor: "rgba(255,255,255,0.1)",
                    borderWidth: 1,
                    borderColor: MMD_GOLD_CLASSIC_BORDER,
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: meta.color,
                        }}
                      />
                      <Text
                        style={{
                          color: meta.color,
                          fontWeight: "700",
                          fontFamily: MMD_FONT.bold,
                          fontSize: 13,
                        }}
                      >
                        {statusLabel}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={{
                      color: MMD_WHITE,
                      fontWeight: "700",
                      fontFamily: MMD_FONT.bold,
                      fontSize: 16,
                      textAlign: textAlignStart(),
                    }}
                    numberOfLines={1}
                  >
                    {String(item.pickup_address ?? "")} → {String(item.dropoff_address ?? "")}
                  </Text>
                  {label || plate ? (
                    <Text
                      style={{
                        color: "rgba(255,255,255,0.5)",
                        fontSize: 13,
                        fontFamily: MMD_FONT.regular,
                      }}
                    >
                      {label || "—"}
                      {plate ? ` · ${plate}` : ""}
                    </Text>
                  ) : null}
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: MMD_WHITE,
                        fontWeight: "700",
                        fontFamily: MMD_FONT.bold,
                        fontSize: 18,
                        textDecorationLine: cancelled ? "line-through" : "none",
                        opacity: cancelled ? 0.4 : 1,
                      }}
                    >
                      {formatTaxiCents(item.total_cents, String(item.currency ?? "USD"))}
                    </Text>
                    {active ? (
                      <Text
                        style={{
                          color: MMD_TAXI_GREEN,
                          fontWeight: "600",
                          fontFamily: MMD_FONT.semibold,
                          fontSize: 14,
                        }}
                      >
                        {t("taxi.history.trackCta", "Track →")}
                      </Text>
                    ) : completed ? (
                      <Text
                        style={{
                          color: MMD_GOLD_CLASSIC,
                          fontWeight: "600",
                          fontFamily: MMD_FONT.semibold,
                          fontSize: 14,
                        }}
                      >
                        ⭐ {t("taxi.history.rate", "Rate")}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        )}
      </View>
      <ClientServiceBottomNav
        active="track"
        appearance="glass"
        accent="green"
        layout="edge"
      />
    </SafeAreaView>
  );
}
