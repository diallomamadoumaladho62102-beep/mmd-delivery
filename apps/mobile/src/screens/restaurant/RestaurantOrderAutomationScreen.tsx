import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { RestaurantBrandLoadingState } from "../../components/restaurant/RestaurantBrandLoadingState";
import {
  fetchRestaurantAutomationSettings,
  requestRestaurantTestPrint,
  updateRestaurantAutomationSettings,
  type RestaurantAutomationSettings,
} from "../../lib/restaurantOrderAutomationApi";
import { useRestaurantAutoPrint } from "../../hooks/useRestaurantAutoPrint";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

const SOUND_ALERT_KEY = "@mmd/restaurant_sound_alert";
const PREP_OPTIONS = [10, 15, 20] as const;
const GLASS_BORDER = "rgba(255,255,255,0.12)";

type Draft = {
  auto_accept_orders_enabled: boolean;
  auto_print_enabled: boolean;
  default_prep_minutes: number;
  sound_alert: boolean;
};

function ToggleRow(props: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{props.label}</Text>
      <Switch
        value={props.value}
        onValueChange={props.onValueChange}
        trackColor={{ false: "rgba(255,255,255,0.25)", true: MMD_TAXI_GREEN }}
        thumbColor={MMD_WHITE}
        ios_backgroundColor="rgba(255,255,255,0.25)"
      />
    </View>
  );
}

export function RestaurantOrderAutomationScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<RestaurantAutomationSettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [result, soundRaw] = await Promise.all([
        fetchRestaurantAutomationSettings(),
        AsyncStorage.getItem(SOUND_ALERT_KEY),
      ]);
      setSettings(result.settings);
      const prep = Number(result.settings.default_prep_minutes) || 15;
      const nearest =
        PREP_OPTIONS.find((n) => n === prep) ??
        PREP_OPTIONS.reduce((best, n) =>
          Math.abs(n - prep) < Math.abs(best - prep) ? n : best,
        );
      setDraft({
        auto_accept_orders_enabled: Boolean(result.settings.auto_accept_orders_enabled),
        auto_print_enabled: Boolean(result.settings.auto_print_enabled),
        default_prep_minutes: nearest,
        sound_alert: soundRaw === "1",
      });
    } catch (error) {
      Alert.alert("Erreur", toUserFacingError(error, "Chargement impossible"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRestaurantAutoPrint(Boolean(settings?.auto_print_enabled));

  const handleSave = useCallback(async () => {
    if (!draft || !settings) return;
    setSaving(true);
    try {
      const saved = await updateRestaurantAutomationSettings({
        auto_accept_orders_enabled: draft.auto_accept_orders_enabled,
        auto_print_enabled: draft.auto_print_enabled,
        default_prep_minutes: draft.default_prep_minutes,
      });
      setSettings(saved);
      await AsyncStorage.setItem(SOUND_ALERT_KEY, draft.sound_alert ? "1" : "0");
      Alert.alert("Saved", "Automation settings updated.");
    } catch (error) {
      Alert.alert("Erreur", toUserFacingError(error, "Enregistrement impossible"));
      await load();
    } finally {
      setSaving(false);
    }
  }, [draft, load, settings]);

  const handleTestPrint = useCallback(async () => {
    try {
      await requestRestaurantTestPrint();
      Alert.alert("Test impression", "Ticket de test ajouté à la file d'impression.");
    } catch (error) {
      Alert.alert("Erreur", toUserFacingError(error, "Test impossible"));
    }
  }, []);

  if (loading || !settings || !draft) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title="Order Automation"
          subtitle="Settings"
          variant="mmd"
          fallbackRoute="RestaurantCommandCenter"
        />
        <RestaurantBrandLoadingState
          title="Loading Settings..."
          subtitle="Fetching your automation preferences"
          glass
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title="Order Automation"
        subtitle="Settings"
        variant="mmd"
        fallbackRoute="RestaurantCommandCenter"
      />
      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.infoCard}>
          <Text style={styles.infoIcon}>⚙️</Text>
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>Auto-accept & Kitchen Print</Text>
            <Text style={styles.infoBody}>
              Control how new orders are accepted and printed.
            </Text>
          </View>
        </View>

        <View style={styles.toggles}>
          <ToggleRow
            label="Auto-accept new orders"
            value={draft.auto_accept_orders_enabled}
            onValueChange={(value) =>
              setDraft((s) => (s ? { ...s, auto_accept_orders_enabled: value } : s))
            }
          />
          <ToggleRow
            label="Auto-print on accept"
            value={draft.auto_print_enabled}
            onValueChange={(value) =>
              setDraft((s) => (s ? { ...s, auto_print_enabled: value } : s))
            }
          />
          <ToggleRow
            label="Sound alert"
            value={draft.sound_alert}
            onValueChange={(value) =>
              setDraft((s) => (s ? { ...s, sound_alert: value } : s))
            }
          />
        </View>

        <View style={styles.prepBlock}>
          <Text style={styles.prepTitle}>⏱️ Default Prep Time</Text>
          <View style={styles.pillRow}>
            {PREP_OPTIONS.map((mins) => {
              const selected = draft.default_prep_minutes === mins;
              return (
                <TouchableOpacity
                  key={mins}
                  style={[styles.pill, selected && styles.pillSelected]}
                  onPress={() =>
                    setDraft((s) => (s ? { ...s, default_prep_minutes: mins } : s))
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={styles.pillText}>{mins} min</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.spacer} />

        <TouchableOpacity
          style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
        >
          <Text style={styles.saveBtnText}>
            {saving ? "Saving…" : "Save Settings"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.testBtn}
          onPress={handleTestPrint}
          accessibilityRole="button"
        >
          <Text style={styles.testBtnText}>Test print</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  container: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
  infoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  infoIcon: { fontSize: 24, color: MMD_WHITE },
  infoText: { flex: 1, gap: 4 },
  infoTitle: {
    color: MMD_WHITE,
    fontSize: 17,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  infoBody: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  toggles: { gap: 12 },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 16,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
    gap: 12,
  },
  toggleLabel: {
    flex: 1,
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.regular,
  },
  prepBlock: { gap: 12 },
  prepTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  pillRow: { flexDirection: "row", gap: 8 },
  pill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: GLASS_BORDER,
  },
  pillSelected: {
    backgroundColor: MMD_TAXI_GREEN,
    borderColor: MMD_TAXI_GREEN,
  },
  pillText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  spacer: { flexGrow: 1, minHeight: 24 },
  saveBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  saveBtnDisabled: { opacity: 0.7 },
  saveBtnText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  testBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  testBtnText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
});

export default RestaurantOrderAutomationScreen;
