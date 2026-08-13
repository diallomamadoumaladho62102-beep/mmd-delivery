import React, { useCallback, useEffect, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Image,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { formatDateTime } from "../../i18n/formatters";
import {
  cancelScheduledTaxiRide,
  fetchScheduledTaxiRides,
  formatTaxiCents,
} from "../../lib/taxiClientApi";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_GREEN,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiScheduled">;

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

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
        toUserFacingError(e, t("taxi.scheduled.loadFailed", "Load failed"))
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
        title={t("taxi.scheduled.title", "Scheduled Rides")}
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

        <TouchableOpacity
          onPress={() => navigation.navigate("TaxiScheduledBook")}
          style={styles.cta}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>
            {t("taxi.scheduled.book", "Book scheduled ride")}
          </Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>
          {t("taxi.scheduled.upcoming", "Upcoming Rides")}
        </Text>

        {loading ? <ActivityIndicator color={MMD_GREEN} /> : null}
        {items.map((item) => {
          const ride = item.taxi_rides as Record<string, unknown> | undefined;
          const id = String(item.id ?? "");
          return (
            <View key={id} style={styles.card}>
              <Text style={styles.cardWhen}>
                {formatDateTime(String(item.scheduled_pickup_at ?? ""), i18n.language)}
              </Text>
              <Text style={styles.cardRoute}>
                {String(ride?.pickup_address ?? "")} →{" "}
                {String(ride?.dropoff_address ?? "")}
              </Text>
              <Text style={styles.cardPrice}>
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
              >
                <Text style={styles.cancel}>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: {
    padding: 20,
    gap: 16,
    alignItems: "center",
  },
  logo: { width: 56, height: 56, borderRadius: 28 },
  brand: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  cta: {
    width: "100%",
    backgroundColor: MMD_GREEN,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  ctaText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 15,
    fontWeight: "800",
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 17,
    fontWeight: "800",
    textAlign: "center",
  },
  card: {
    width: "100%",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    gap: 4,
  },
  cardWhen: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.bold,
    fontSize: 15,
    fontWeight: "700",
  },
  cardRoute: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.regular,
    fontSize: 13,
  },
  cardPrice: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
    fontWeight: "600",
  },
  cancel: {
    color: "#EF4444",
    fontFamily: MMD_FONT.semibold,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
});
