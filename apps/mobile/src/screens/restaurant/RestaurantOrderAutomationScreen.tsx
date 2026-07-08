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
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  fetchRestaurantAutomationSettings,
  requestRestaurantTestPrint,
  updateRestaurantAutomationSettings,
  type RestaurantAutomationSettings,
} from "../../lib/restaurantOrderAutomationApi";
import { useRestaurantAutoPrint } from "../../hooks/useRestaurantAutoPrint";

function ToggleRow(props: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{props.label}</Text>
        {props.description ? <Text style={styles.rowHint}>{props.description}</Text> : null}
      </View>
      <Switch value={props.value} onValueChange={props.onValueChange} />
    </View>
  );
}

export function RestaurantOrderAutomationScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<RestaurantAutomationSettings | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchRestaurantAutomationSettings();
      setSettings(result.settings);
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRestaurantAutoPrint(Boolean(settings?.auto_print_enabled));

  const patch = useCallback(
    async (next: Partial<RestaurantAutomationSettings>) => {
      if (!settings) return;
      const merged = { ...settings, ...next };
      setSettings(merged);
      setSaving(true);
      try {
        const saved = await updateRestaurantAutomationSettings(next);
        setSettings(saved);
      } catch (error) {
        Alert.alert("Erreur", error instanceof Error ? error.message : "Enregistrement impossible");
        await load();
      } finally {
        setSaving(false);
      }
    },
    [load, settings],
  );

  const handleTestPrint = useCallback(async () => {
    try {
      await requestRestaurantTestPrint();
      Alert.alert("Test impression", "Ticket de test ajouté à la file d'impression.");
    } catch (error) {
      Alert.alert("Erreur", error instanceof Error ? error.message : "Test impossible");
    }
  }, []);

  if (loading || !settings) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title="Commandes & impression"
          variant="light"
          fallbackRoute="RestaurantCommandCenter"
        />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#EA580C" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title="Commandes & impression"
        subtitle="Acceptation automatique, temps de préparation et tickets thermiques 58/80 mm."
        variant="light"
        fallbackRoute="RestaurantCommandCenter"
      />
      <ScrollView contentContainerStyle={styles.container}>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Acceptation automatique</Text>
          <ToggleRow
            label="Acceptation automatique des commandes"
            description="Accepte les commandes payées sans action manuelle."
            value={settings.auto_accept_orders_enabled}
            onValueChange={(value) => patch({ auto_accept_orders_enabled: value })}
          />
          <ToggleRow
            label="Uniquement pendant les horaires d'ouverture"
            value={settings.auto_accept_only_during_hours}
            onValueChange={(value) => patch({ auto_accept_only_during_hours: value })}
          />
          <ToggleRow
            label="Pause auto si fermé"
            value={settings.auto_pause_when_closed}
            onValueChange={(value) => patch({ auto_pause_when_closed: value })}
          />
          <ToggleRow
            label="Pause auto si trop occupé"
            value={settings.auto_pause_when_busy}
            onValueChange={(value) => patch({ auto_pause_when_busy: value })}
          />

          <Text style={styles.fieldLabel}>Temps de préparation par défaut (minutes)</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(settings.default_prep_minutes)}
            onChangeText={(text) => patch({ default_prep_minutes: Number(text) || 20 })}
          />

          <Text style={styles.fieldLabel}>Seuil commandes actives (occupé)</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(settings.busy_order_threshold)}
            onChangeText={(text) => patch({ busy_order_threshold: Number(text) || 12 })}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Impression automatique</Text>
          <ToggleRow
            label="Impression automatique après acceptation"
            value={settings.auto_print_enabled}
            onValueChange={(value) => patch({ auto_print_enabled: value })}
          />
          <ToggleRow
            label="Ticket cuisine"
            value={settings.print_kitchen_ticket}
            onValueChange={(value) => patch({ print_kitchen_ticket: value })}
          />
          <ToggleRow
            label="Ticket client"
            value={settings.print_customer_ticket}
            onValueChange={(value) => patch({ print_customer_ticket: value })}
          />
          <ToggleRow
            label="Ticket chauffeur"
            value={settings.print_driver_ticket}
            onValueChange={(value) => patch({ print_driver_ticket: value })}
          />
          <ToggleRow
            label="QR / numéro de commande"
            value={settings.print_show_qr_code}
            onValueChange={(value) => patch({ print_show_qr_code: value })}
          />
          <ToggleRow
            label="Instructions spéciales"
            value={settings.print_special_instructions}
            onValueChange={(value) => patch({ print_special_instructions: value })}
          />

          <Text style={styles.fieldLabel}>Nombre de copies</Text>
          <TextInput
            style={styles.input}
            keyboardType="number-pad"
            value={String(settings.print_copies)}
            onChangeText={(text) => patch({ print_copies: Number(text) || 1 })}
          />

          <Text style={styles.fieldLabel}>Largeur papier</Text>
          <View style={styles.segmentRow}>
            {(["58mm", "80mm"] as const).map((width) => (
              <TouchableOpacity
                key={width}
                style={[
                  styles.segmentBtn,
                  settings.print_paper_width === width && styles.segmentBtnActive,
                ]}
                onPress={() => patch({ print_paper_width: width })}
              >
                <Text
                  style={[
                    styles.segmentText,
                    settings.print_paper_width === width && styles.segmentTextActive,
                  ]}
                >
                  {width}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleTestPrint}>
            <Text style={styles.primaryBtnText}>Test impression</Text>
          </TouchableOpacity>
        </View>

        {saving ? <Text style={styles.saving}>Enregistrement…</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#FFF7ED" },
  container: { padding: 20, paddingTop: 8, gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    backgroundColor: "#fff",
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "#FED7AA",
  },
  sectionTitle: { fontSize: 18, fontWeight: "700", color: "#9A3412", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowLabel: { fontSize: 15, fontWeight: "600", color: "#1F2937" },
  rowHint: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#FDBA74",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFBEB",
  },
  segmentRow: { flexDirection: "row", gap: 10 },
  segmentBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#FDBA74",
    paddingVertical: 12,
    alignItems: "center",
  },
  segmentBtnActive: { backgroundColor: "#EA580C", borderColor: "#EA580C" },
  segmentText: { fontWeight: "700", color: "#9A3412" },
  segmentTextActive: { color: "#fff" },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: "#EA580C",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  saving: { textAlign: "center", color: "#6B7280" },
});

export default RestaurantOrderAutomationScreen;
