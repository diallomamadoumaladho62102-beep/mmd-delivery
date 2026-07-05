import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  fetchDriverServicePreferences,
  updateDriverServicePreferences,
  type DriverServicePreferences,
} from "../../lib/driverServicePreferencesApi";

function ToggleRow(props: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>{props.label}</Text>
        <Text style={styles.description}>{props.description}</Text>
      </View>
      <Switch value={props.value} onValueChange={props.onValueChange} />
    </View>
  );
}

export function DriverServicesScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [prefs, setPrefs] = useState<DriverServicePreferences>({
    food_delivery_enabled: false,
    package_delivery_enabled: false,
    taxi_rides_enabled: false,
    accept_also_standard_rides: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDriverServicePreferences();
      setPrefs(data.preferences);
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (next: DriverServicePreferences) => {
      setSaving(true);
      try {
        const saved = await updateDriverServicePreferences(next);
        setPrefs(saved);
      } catch (error) {
        Alert.alert(
          "Services",
          error instanceof Error ? error.message : "Enregistrement impossible",
        );
        await load();
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const patch = (key: keyof DriverServicePreferences, value: boolean) => {
    const next = { ...prefs, [key]: value };
    const enabledCount = [
      next.food_delivery_enabled,
      next.package_delivery_enabled,
      next.taxi_rides_enabled,
    ].filter(Boolean).length;

    if (enabledCount === 0) {
      Alert.alert(
        "Mes services",
        "Activez au moins un service pour recevoir des missions.",
      );
      return;
    }

    setPrefs(next);
    void save(next);
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
        <Text style={styles.title}>Mes services</Text>
        <Text style={styles.subtitle}>
          Choisissez les types de missions que vous souhaitez recevoir. Le dispatch respecte
          uniquement vos préférences enregistrées.
        </Text>

        <ToggleRow
          label="Food delivery"
          description="Commandes restaurant et livraison repas"
          value={prefs.food_delivery_enabled}
          onValueChange={(v) => patch("food_delivery_enabled", v)}
        />
        <ToggleRow
          label="Package delivery"
          description="Livraison colis et courses"
          value={prefs.package_delivery_enabled}
          onValueChange={(v) => patch("package_delivery_enabled", v)}
        />
        <ToggleRow
          label="Taxi rides"
          description="Courses taxi selon les catégories autorisées de votre véhicule"
          value={prefs.taxi_rides_enabled}
          onValueChange={(v) => patch("taxi_rides_enabled", v)}
        />
        {prefs.taxi_rides_enabled ? (
          <ToggleRow
            label="Accepter aussi les courses Standard"
            description="Comfort, XL ou Wheelchair peuvent recevoir des courses Standard"
            value={prefs.accept_also_standard_rides}
            onValueChange={(v) => patch("accept_also_standard_rides", v)}
          />
        ) : null}

        {saving && <Text style={styles.saving}>Enregistrement…</Text>}

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => void load()}>
          <Text style={styles.secondaryBtnText}>Actualiser</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 24, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 14, color: "#64748b", marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },
  label: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  description: { fontSize: 13, color: "#64748b", marginTop: 4 },
  saving: { fontSize: 13, color: "#64748b" },
  secondaryBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  secondaryBtnText: { color: "#0f172a", fontWeight: "600" },
});

export default DriverServicesScreen;
