import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import ScreenHeader from "../../components/navigation/ScreenHeader";
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

  return (
    <View style={[styles.card, vehicle.is_active && styles.cardActive]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        {vehicle.is_active ? <Text style={styles.activeBadge}>Actif</Text> : null}
      </View>
      <Text style={styles.meta}>
        {vehicle.vehicle_year ?? "—"} · {vehicle.license_plate ?? "—"} · {fuelLabel(vehicle.fuel_type)}
      </Text>
      <Text style={styles.meta}>Statut : {vehicle.vehicle_status}</Text>
      <View style={styles.categories}>
        {vehicle.categories.map((cat) => (
          <Text key={cat.category} style={[styles.chip, { color: cat.status === "eligible" ? "#15803d" : "#64748b" }]}>
            {cat.label}: {cat.status}
          </Text>
        ))}
      </View>
      {vehicle.admin_review_notes ? (
        <Text style={styles.note}>Admin : {vehicle.admin_review_notes}</Text>
      ) : null}
      <View style={styles.actions}>
        {!vehicle.is_active ? (
          <TouchableOpacity
            style={[styles.btn, isOnline && styles.btnDisabled]}
            disabled={isOnline}
            onPress={props.onSelectActive}
          >
            <Text style={styles.btnText}>{isOnline ? "Hors ligne requis" : "Activer"}</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity style={styles.btnSecondary} onPress={props.onEdit}>
          <Text style={styles.btnSecondaryText}>Modifier</Text>
        </TouchableOpacity>
        {!vehicle.is_active ? (
          <TouchableOpacity style={styles.btnDanger} onPress={props.onDelete}>
            <Text style={styles.btnDangerText}>Supprimer</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function DriverVehiclesScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [vehicles, setVehicles] = useState<DriverVehicleListItem[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [history, setHistory] = useState<Array<{ action: string; created_at: string }>>([]);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDriverVehiclesList();
      setVehicles(data.vehicles);
      setIsOnline(data.is_online);
      setHistory(data.history.slice(0, 10));
    } catch (error) {
      Alert.alert("Erreur", toUserFacingError(error, "Impossible de charger vos véhicules pour le moment."));
    } finally {
      setLoading(false);
    }
  }, []);

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
      Alert.alert("Véhicule actif", toUserFacingError(error, "Impossible de changer le véhicule actif pour le moment."));
    }
  };

  const remove = (vehicleId: string) => {
    Alert.alert("Supprimer", "Supprimer ce véhicule ?", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await deleteDriverVehicle(vehicleId);
              await load();
            } catch (error) {
              Alert.alert("Erreur", toUserFacingError(error, "Impossible de supprimer ce véhicule pour le moment."));
            }
          })();
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title="Mes véhicules"
          variant="light"
          fallbackRoute="DriverTabs"
        />
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title="Mes véhicules"
        subtitle="Un seul véhicule actif à la fois. Changez de véhicule uniquement lorsque vous êtes hors ligne."
        variant="light"
        fallbackRoute="DriverTabs"
      />
      <ScrollView contentContainerStyle={styles.content}>

        {vehicles.map((vehicle) => (
          <VehicleCard
            key={vehicle.id}
            vehicle={vehicle}
            isOnline={isOnline}
            onSelectActive={() => void activate(vehicle.id)}
            onEdit={() => navigation.navigate("DriverVehicle", { vehicleId: vehicle.id })}
            onDelete={() => remove(vehicle.id)}
          />
        ))}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => navigation.navigate("DriverVehicle", { vehicleId: "new" })}
        >
          <Text style={styles.addBtnText}>+ Ajouter un véhicule</Text>
        </TouchableOpacity>

        {history.length > 0 ? (
          <View style={styles.history}>
            <Text style={styles.historyTitle}>Historique récent</Text>
            {history.map((row, index) => (
              <Text key={`${row.action}-${index}`} style={styles.historyRow}>
                {row.action} · {new Date(row.created_at).toLocaleString()}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 8, gap: 12 },
  card: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  cardActive: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  activeBadge: { color: "#2563eb", fontWeight: "700", fontSize: 12 },
  meta: { fontSize: 13, color: "#64748b" },
  categories: { gap: 4, marginTop: 4 },
  chip: { fontSize: 12 },
  note: { fontSize: 12, color: "#b45309", marginTop: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  btn: { backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  btnDisabled: { backgroundColor: "#94a3b8" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  btnSecondary: { borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  btnSecondaryText: { color: "#0f172a", fontWeight: "600", fontSize: 13 },
  btnDanger: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  btnDangerText: { color: "#b91c1c", fontWeight: "600", fontSize: 13 },
  addBtn: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
  },
  addBtnText: { color: "#2563eb", fontWeight: "700" },
  history: { marginTop: 16, gap: 4 },
  historyTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  historyRow: { fontSize: 12, color: "#64748b" },
});

export default DriverVehiclesScreen;
