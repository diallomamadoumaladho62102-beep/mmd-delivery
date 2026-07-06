import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  fetchDriverVehicleSnapshot,
  fetchDriverCapabilities,
  requestDriverVehicleReview,
  updateDriverCapabilities,
  updateDriverVehicle,
  type VehicleCategoryStatus,
} from "../../lib/driverServicePreferencesApi";

function statusColor(status: string) {
  if (status === "eligible") return "#15803d";
  if (status === "pending_review") return "#b45309";
  if (status === "expired_age" || status === "missing_documents") return "#b91c1c";
  return "#64748b";
}

export function DriverVehicleScreen() {
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
      const [data, capabilities] = await Promise.all([
        fetchDriverVehicleSnapshot(),
        fetchDriverCapabilities().catch(() => ({ non_smoking: false })),
      ]);
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
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const [data] = await Promise.all([
        updateDriverVehicle({
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
        }),
        updateDriverCapabilities({ non_smoking: form.non_smoking }),
      ]);
      setCategories(data.categories);
      Alert.alert("Véhicule", "Informations enregistrées. L'éligibilité a été recalculée.");
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setSaving(false);
    }
  };

  const requestReview = async () => {
    try {
      await requestDriverVehicleReview();
      Alert.alert("Revue admin", "Votre demande a été envoyée à l'équipe MMD.");
      await load();
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Demande impossible");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Mon véhicule</Text>
        <Text style={styles.subtitle}>
          Les catégories taxi sont calculées par le serveur. Vous ne pouvez pas vous auto-attribuer
          Comfort, XL ou Wheelchair.
        </Text>

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

        <Text style={[styles.title, { marginTop: 16, fontSize: 18 }]}>Capacités & préférences client</Text>
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
          <Text style={styles.primaryBtnText}>{saving ? "Enregistrement…" : "Enregistrer"}</Text>
        </TouchableOpacity>

        <Text style={[styles.title, { marginTop: 24 }]}>Catégories autorisées</Text>
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

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => void requestReview()}>
          <Text style={styles.secondaryBtnText}>Demander une revue admin</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, gap: 10 },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 8 },
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
  secondaryBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  secondaryBtnText: { color: "#0f172a", fontWeight: "600" },
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
