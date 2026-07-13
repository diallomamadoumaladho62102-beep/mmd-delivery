import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  addDriverVehicle,
  fetchDriverCapabilities,
  fetchDriverVehicleById,
  updateDriverCapabilities,
  updateDriverVehicleById,
  type VehicleCategoryStatus,
} from "../../lib/driverServicePreferencesApi";
import { toUserFacingError } from "../../lib/userFacingError";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverVehicle">;
type Rt = RouteProp<RootStackParamList, "DriverVehicle">;

function statusColor(status: string) {
  if (status === "eligible") return "#15803d";
  if (status === "pending_review") return "#b45309";
  if (status === "expired_age" || status === "missing_documents") return "#b91c1c";
  return "#64748b";
}

export function DriverVehicleScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const paramVehicleId = route.params?.vehicleId;
  // "new" (or missing param) => create a distinct vehicle via the multi-vehicle
  // POST endpoint. A real id => edit that specific vehicle by id. This screen must
  // never fall back to the legacy singular /api/driver/vehicle endpoint, which only
  // ever targets the driver's primary vehicle and would silently overwrite it.
  const vehicleId =
    paramVehicleId && paramVehicleId !== "new" ? paramVehicleId : null;
  const isCreate = vehicleId === null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<VehicleCategoryStatus[]>([]);
  const [form, setForm] = useState({
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: "",
    vehicle_color: "",
    license_plate: "",
    seats_count: "4",
    vehicle_type: "sedan",
    has_air_conditioning: false,
    wheelchair_accessible: false,
    fuel_type: "gasoline",
    nickname: "",
    child_seat_available: false,
    pets_allowed: false,
    large_luggage: false,
    phone_charger_available: false,
    quiet_vehicle: false,
    non_smoking: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const capabilities = await fetchDriverCapabilities().catch(() => ({
        non_smoking: false,
      }));

      if (vehicleId) {
        const data = await fetchDriverVehicleById(vehicleId);
        setCategories(data.categories);
        const v = data.vehicle;
        if (v) {
          setForm({
            vehicle_make: String(v.vehicle_make ?? ""),
            vehicle_model: String(v.vehicle_model ?? ""),
            vehicle_year: v.vehicle_year != null ? String(v.vehicle_year) : "",
            vehicle_color: String(v.vehicle_color ?? ""),
            license_plate: String(v.license_plate ?? ""),
            seats_count: String(v.seats_count ?? 4),
            vehicle_type: String(v.vehicle_type ?? "sedan"),
            has_air_conditioning: Boolean(v.has_air_conditioning),
            wheelchair_accessible: Boolean(v.wheelchair_accessible),
            fuel_type: String(v.fuel_type ?? "gasoline"),
            nickname: String(v.nickname ?? ""),
            child_seat_available: Boolean(v.child_seat_available),
            pets_allowed: Boolean(v.pets_allowed),
            large_luggage: Boolean(v.large_luggage),
            phone_charger_available: Boolean(v.phone_charger_available),
            quiet_vehicle: Boolean(v.quiet_vehicle),
            non_smoking: capabilities.non_smoking,
          });
        } else {
          setForm((prev) => ({ ...prev, non_smoking: capabilities.non_smoking }));
        }
      } else {
        setCategories([]);
        setForm((prev) => ({ ...prev, non_smoking: capabilities.non_smoking }));
      }
    } catch (error) {
      Alert.alert("Erreur", toUserFacingError(error, "Impossible de charger les informations du véhicule."));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        vehicle_make: form.vehicle_make.trim(),
        vehicle_model: form.vehicle_model.trim(),
        vehicle_year: Number(form.vehicle_year) || null,
        vehicle_color: form.vehicle_color.trim(),
        license_plate: form.license_plate.trim(),
        seats_count: Number(form.seats_count) || 4,
        vehicle_type: form.vehicle_type.trim(),
        has_air_conditioning: form.has_air_conditioning,
        wheelchair_accessible: form.wheelchair_accessible,
        fuel_type: form.fuel_type,
        nickname: form.nickname.trim() || null,
        child_seat_available: form.child_seat_available,
        pets_allowed: form.pets_allowed,
        large_luggage: form.large_luggage,
        phone_charger_available: form.phone_charger_available,
        quiet_vehicle: form.quiet_vehicle,
      };

      await updateDriverCapabilities({ non_smoking: form.non_smoking });

      if (vehicleId) {
        await updateDriverVehicleById(vehicleId, payload);
      } else {
        await addDriverVehicle(payload);
      }

      Alert.alert(
        "Véhicule",
        isCreate
          ? "Véhicule ajouté. Il est en attente de validation par l'équipe MMD."
          : "Informations enregistrées. L'éligibilité a été recalculée.",
      );
      navigation.goBack();
    } catch (error) {
      Alert.alert("Erreur", toUserFacingError(error, "Impossible d'enregistrer le véhicule pour le moment."));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
        <ScreenHeader title="Véhicule" variant="light" fallbackRoute="DriverVehicles" />
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={isCreate ? "Ajouter un véhicule" : "Véhicule"}
        subtitle="Les catégories taxi sont calculées par le serveur. Vous ne pouvez pas vous auto-attribuer Comfort, XL ou Wheelchair."
        variant="light"
        fallbackRoute="DriverVehicles"
      />
      <ScrollView contentContainerStyle={styles.content}>

        {[
          ["vehicle_make", "Marque"],
          ["vehicle_model", "Modèle"],
          ["vehicle_year", "Année"],
          ["vehicle_color", "Couleur"],
          ["license_plate", "Plaque"],
          ["seats_count", "Places passagers"],
          ["vehicle_type", "Type (sedan, suv, van, minivan)"],
          ["fuel_type", "Motorisation (gasoline, diesel, hybrid, electric, plug_in_hybrid)"],
          ["nickname", "Surnom (optionnel)"],
        ].map(([key, label]) => (
          <View key={key}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={(form as Record<string, string | boolean>)[key] as string}
              onChangeText={(text) => setForm((prev) => ({ ...prev, [key]: text }))}
            />
          </View>
        ))}

        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Climatisation</Text>
          <Switch
            value={form.has_air_conditioning}
            onValueChange={(v) => setForm((prev) => ({ ...prev, has_air_conditioning: v }))}
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Accessible fauteuil roulant</Text>
          <Switch
            value={form.wheelchair_accessible}
            onValueChange={(v) => setForm((prev) => ({ ...prev, wheelchair_accessible: v }))}
          />
        </View>

        <Text style={[styles.sectionTitle, { marginTop: 16, fontSize: 18 }]}>Capacités & préférences client</Text>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Chauffeur non-fumeur</Text>
          <Switch
            value={form.non_smoking}
            onValueChange={(v) => setForm((prev) => ({ ...prev, non_smoking: v }))}
          />
        </View>
        {(
          [
            ["child_seat_available", "Siège enfant disponible"],
            ["pets_allowed", "Animaux acceptés"],
            ["large_luggage", "Grand espace bagages"],
            ["phone_charger_available", "Chargeur téléphone"],
            ["quiet_vehicle", "Véhicule silencieux"],
          ] as const
        ).map(([key, label]) => (
          <View style={styles.row} key={key}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <Switch
              value={form[key as keyof typeof form] as boolean}
              onValueChange={(v) => setForm((prev) => ({ ...prev, [key]: v }))}
            />
          </View>
        ))}

        <TouchableOpacity style={styles.primaryBtn} disabled={saving} onPress={() => void save()}>
          <Text style={styles.primaryBtnText}>
            {saving ? "Enregistrement…" : isCreate ? "Ajouter le véhicule" : "Enregistrer"}
          </Text>
        </TouchableOpacity>

        {!isCreate && categories.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Catégories autorisées</Text>
            {categories.map((cat) => (
              <View key={cat.category} style={styles.categoryCard}>
                <Text style={styles.categoryTitle}>{cat.label}</Text>
                <Text style={[styles.categoryStatus, { color: statusColor(cat.status) }]}>
                  {cat.status}
                </Text>
                {cat.reason_message ? (
                  <Text style={styles.categoryReason}>{cat.reason_message}</Text>
                ) : null}
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, paddingTop: 8, gap: 10 },
  sectionTitle: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  fieldLabel: { fontSize: 14, fontWeight: "600", color: "#334155" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  primaryBtn: {
    backgroundColor: "#ea580c",
    borderRadius: 10,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  categoryCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  categoryTitle: { fontSize: 16, fontWeight: "600" },
  categoryStatus: { fontSize: 14, marginTop: 4, fontWeight: "600" },
  categoryReason: { fontSize: 13, color: "#64748b", marginTop: 4 },
});

export default DriverVehicleScreen;
