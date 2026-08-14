/**
 * Driver Vehicles — Figma Lot 6 (311:6565 Loading, 311:6576 List).
 * Logic/APIs unchanged; visual tokens from mmdUi.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../../components/driver/DriverBrandLoadingState";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  deleteDriverVehicle,
  fetchDriverVehiclesList,
  setDriverActiveVehicle,
  type DriverVehicleListItem,
} from "../../lib/driverServicePreferencesApi";
import { supabase } from "../../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../../lib/supabaseRealtime";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");
const AMBER = "#F59E0B";
const DANGER = "#EF4444";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverVehicles">;

function fuelLabel(fuel: string) {
  const map: Record<string, string> = {
    electric: "Électrique",
    hybrid: "Hybride",
    plug_in_hybrid: "Hybride rechargeable",
    gasoline: "Essence",
    diesel: "Diesel",
  };
  return map[fuel] ?? fuel;
}

function statusBadge(vehicle: DriverVehicleListItem): {
  label: string;
  color: string;
  bg: string;
} {
  if (vehicle.is_active) {
    return {
      label: "Actif",
      color: MMD_TAXI_GREEN,
      bg: "rgba(34,197,94,0.1)",
    };
  }
  const pending =
    vehicle.vehicle_status === "pending_review" ||
    vehicle.categories.some((c) => c.status === "pending_review");
  if (pending) {
    return { label: "En attente", color: AMBER, bg: "rgba(245,158,11,0.1)" };
  }
  return {
    label: vehicle.vehicle_status || "Inactif",
    color: "rgba(255,255,255,0.7)",
    bg: "rgba(255,255,255,0.08)",
  };
}

function VehicleCard(props: {
  vehicle: DriverVehicleListItem;
  isOnline: boolean;
  onSelectActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { vehicle, isOnline } = props;
  const title =
    vehicle.nickname?.trim() ||
    [vehicle.vehicle_make, vehicle.vehicle_model].filter(Boolean).join(" ") ||
    "Véhicule";
  const badge = statusBadge(vehicle);
  const emoji = vehicle.is_active ? "🚗" : "🚙";
  const categoriesLine = vehicle.categories
    .map((cat) =>
      vehicle.is_active
        ? `${cat.label}, ${cat.status}`
        : `${cat.label}: ${cat.status}`,
    )
    .join(" · ");

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.emoji}>{emoji}</Text>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.cardTitle}>{title}</Text>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badgeText, { color: badge.color }]}>
              {badge.label}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.meta}>
        {vehicle.vehicle_year ?? "—"} · {vehicle.license_plate ?? "—"} ·{" "}
        {fuelLabel(vehicle.fuel_type)}
      </Text>

      {vehicle.is_active ? (
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text style={styles.meta}>Statut: {vehicle.vehicle_status}</Text>
        </View>
      ) : (
        <Text style={styles.meta}>Statut: {vehicle.vehicle_status}</Text>
      )}

      {categoriesLine ? (
        <Text style={styles.categories}>{categoriesLine}</Text>
      ) : null}

      {vehicle.admin_review_notes ? (
        <Text style={styles.note}>Admin : {vehicle.admin_review_notes}</Text>
      ) : null}

      <View style={styles.actions}>
        {!vehicle.is_active ? (
          <TouchableOpacity
            style={[styles.btnPrimary, isOnline && styles.btnDisabled]}
            disabled={isOnline}
            onPress={props.onSelectActive}
            activeOpacity={0.9}
          >
            <Text style={styles.btnPrimaryText}>
              {isOnline ? "Hors ligne requis" : "Activer"}
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={vehicle.is_active ? styles.btnOutlineGreen : styles.btnOutlineWhite}
          onPress={props.onEdit}
          activeOpacity={0.9}
        >
          <Text
            style={
              vehicle.is_active
                ? styles.btnOutlineGreenText
                : styles.btnOutlineWhiteText
            }
          >
            Modifier
          </Text>
        </TouchableOpacity>
        {!vehicle.is_active ? (
          <TouchableOpacity
            style={styles.btnDanger}
            onPress={props.onDelete}
            activeOpacity={0.9}
          >
            <Text style={styles.btnDangerText}>Supprimer</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function BrandFooter() {
  return (
    <View style={styles.brandFooter}>
      <Image
        source={MMD_LOGO}
        style={styles.brandLogo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.brandLabel}>MMD Delivery</Text>
    </View>
  );
}

export function DriverVehiclesScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<DriverVehicleListItem[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [history, setHistory] = useState<
    Array<{ action: string; created_at: string }>
  >([]);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDriverVehiclesList();
      setVehicles(data.vehicles);
      setIsOnline(data.is_online);
      setHistory(data.history.slice(0, 10));
    } catch (error) {
      Alert.alert(
        t("driver.vehicles.errorTitle", "Error"),
        toUserFacingError(
          error,
          t("driver.vehicles.loadFailed", "Unable to load your vehicles right now."),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      void load();
    }, 250);
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    let cancelled = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const subscribe = async () => {
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user?.id;
      if (!userId || cancelled) return;

      channel = subscribePostgresChannel(
        `driver-vehicles-${userId}`,
        [
          {
            event: "*",
            table: "driver_vehicles",
            filter: `driver_user_id=eq.${userId}`,
            callback: () => scheduleReload(),
          },
          {
            event: "*",
            table: "vehicle_category_eligibility",
            filter: `driver_user_id=eq.${userId}`,
            callback: () => scheduleReload(),
          },
          {
            event: "UPDATE",
            table: "driver_profiles",
            filter: `user_id=eq.${userId}`,
            callback: () => scheduleReload(),
          },
        ],
      );
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
      void unsubscribeSupabaseChannel(channel);
    };
  }, [scheduleReload]);

  const activate = async (vehicleId: string) => {
    try {
      await setDriverActiveVehicle(vehicleId);
      await load();
    } catch (error) {
      Alert.alert(
        t("driver.vehicles.activeTitle", "Active vehicle"),
        toUserFacingError(
          error,
          t(
            "driver.vehicles.activeFailed",
            "Unable to change the active vehicle right now.",
          ),
        ),
      );
    }
  };

  const remove = (vehicleId: string) => {
    Alert.alert(
      t("driver.vehicles.deleteTitle", "Delete"),
      t("driver.vehicles.deleteBody", "Delete this vehicle?"),
      [
        { text: t("driver.vehicles.cancel", "Cancel"), style: "cancel" },
        {
          text: t("driver.vehicles.deleteConfirm", "Delete"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteDriverVehicle(vehicleId);
              await load();
            } catch (error) {
              Alert.alert(
                t("driver.vehicles.errorTitle", "Error"),
                toUserFacingError(
                  error,
                  t(
                    "driver.vehicles.deleteFailed",
                    "Unable to delete this vehicle right now.",
                  ),
                ),
              );
            }
          })();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title="Mes véhicules"
          subtitle="Gérez votre flotte de véhicules"
          variant="dark"
          fallbackRoute="DriverTabs"
        />
        <DriverBrandLoadingState
          title="Chargement de vos véhicules..."
          logoAtBottom
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title="Mes véhicules"
        subtitle="Un seul véhicule actif à la fois"
        variant="dark"
        fallbackRoute="DriverTabs"
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            isOnline={isOnline}
            onSelectActive={() => void activate(vehicle.id)}
            onEdit={() =>
              navigation.navigate("DriverVehicle", { vehicleId: vehicle.id })
            }
            onDelete={() => remove(vehicle.id)}
          />
        ))}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() =>
            navigation.navigate("DriverVehicle", { vehicleId: "new" })
          }
          activeOpacity={0.9}
        >
          <Text style={styles.addBtnText}>+ Ajouter un véhicule</Text>
        </TouchableOpacity>

        {history.length > 0 ? (
          <View style={styles.history}>
            <Text style={styles.historyTitle}>📋 Historique récent</Text>
            {history.map((row, index) => (
              <Text key={`${row.action}-${index}`} style={styles.historyRow}>
                {row.action} · {new Date(row.created_at).toLocaleString()}
              </Text>
            ))}
          </View>
        ) : null}

        <BrandFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: MMD_BLUE },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    gap: 12,
    flexGrow: 1,
  },
  card: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  emoji: { fontSize: 28, lineHeight: 34 },
  cardTitleBlock: { flex: 1, gap: 4 },
  cardTitle: {
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    color: MMD_WHITE,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  meta: {
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    color: "rgba(255,255,255,0.6)",
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: MMD_TAXI_GREEN,
  },
  categories: {
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
    color: "rgba(255,255,255,0.5)",
  },
  note: {
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
    color: AMBER,
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  btnPrimary: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnDisabled: { backgroundColor: "rgba(255,255,255,0.25)" },
  btnPrimaryText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  btnOutlineGreen: {
    borderWidth: 1,
    borderColor: MMD_TAXI_GREEN,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnOutlineGreenText: {
    color: MMD_TAXI_GREEN,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  btnOutlineWhite: {
    borderWidth: 1,
    borderColor: MMD_WHITE,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnOutlineWhiteText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  btnDanger: {
    borderWidth: 1,
    borderColor: DANGER,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  btnDangerText: {
    color: DANGER,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  addBtn: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: MMD_TAXI_GREEN,
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  addBtnText: {
    color: MMD_TAXI_GREEN,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  history: { marginTop: 16, gap: 4 },
  historyTitle: {
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    color: MMD_WHITE,
  },
  historyRow: {
    fontSize: 11,
    fontFamily: MMD_FONT.regular,
    color: "rgba(255,255,255,0.4)",
  },
  brandFooter: {
    marginTop: "auto",
    paddingTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  brandLogo: { width: 40, height: 40, borderRadius: 12 },
  brandLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});

export default DriverVehiclesScreen;
