/**
 * Driver Services — Figma Lot 6 (311:6259 Loading, 311:6530 Modern).
 * Logic/APIs unchanged; visual tokens from mmdUi.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../../components/driver/DriverBrandLoadingState";
import {
  fetchDriverServicePreferences,
  updateDriverServicePreferences,
  type DriverServicePreferences,
} from "../../lib/driverServicePreferencesApi";
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

function ToggleRow(props: {
  emoji: string;
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.emoji}>{props.emoji}</Text>
      <View style={styles.rowText}>
        <Text style={styles.label}>{props.label}</Text>
        <Text style={styles.description}>{props.description}</Text>
      </View>
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
      Alert.alert(
        "Erreur",
        toUserFacingError(
          error,
          "Impossible de charger vos services pour le moment.",
        ),
      );
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
          toUserFacingError(
            error,
            "Impossible d'enregistrer vos préférences pour le moment.",
          ),
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
      <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title="Mes services"
          subtitle="Gérez vos types de missions"
          variant="dark"
          fallbackRoute="DriverTabs"
        />
        <DriverBrandLoadingState
          title="Chargement de vos services..."
          logoAtBottom
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title="Mes services"
        subtitle="Gérez vos types de missions"
        variant="dark"
        fallbackRoute="DriverTabs"
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>📋 Services disponibles</Text>

        <ToggleRow
          emoji="🍔"
          label="Food delivery"
          description="Commandes restaurant et livraison repas"
          value={prefs.food_delivery_enabled}
          onValueChange={(v) => patch("food_delivery_enabled", v)}
        />
        <ToggleRow
          emoji="📦"
          label="Package delivery"
          description="Livraison colis et courses"
          value={prefs.package_delivery_enabled}
          onValueChange={(v) => patch("package_delivery_enabled", v)}
        />
        <ToggleRow
          emoji="🚕"
          label="Taxi rides"
          description="Courses taxi selon les catégories autorisées de votre véhicule"
          value={prefs.taxi_rides_enabled}
          onValueChange={(v) => patch("taxi_rides_enabled", v)}
        />

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>⚙️ Options avancées</Text>
        {prefs.taxi_rides_enabled ? (
          <ToggleRow
            emoji="⚡"
            label="Accepter aussi les courses Standard"
            description="Comfort, XL ou Wheelchair peuvent recevoir des courses Standard"
            value={prefs.accept_also_standard_rides}
            onValueChange={(v) => patch("accept_also_standard_rides", v)}
          />
        ) : (
          <View style={styles.rowMuted}>
            <Text style={styles.description}>
              Activez Taxi rides pour gérer les options avancées.
            </Text>
          </View>
        )}

        {saving ? (
          <Text style={styles.saving}>Enregistrement…</Text>
        ) : null}

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => void load()}
          activeOpacity={0.9}
        >
          <Text style={styles.primaryBtnText}>Actualiser les préférences</Text>
        </TouchableOpacity>

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
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginTop: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: MMD_ACTION_NAVY,
  },
  rowMuted: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: MMD_ACTION_NAVY,
  },
  emoji: { fontSize: 28, lineHeight: 36 },
  rowText: { flex: 1, gap: 2 },
  label: {
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    color: MMD_WHITE,
  },
  description: {
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
    color: "rgba(255,255,255,0.5)",
    lineHeight: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.1)",
    marginVertical: 4,
  },
  saving: {
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    color: "rgba(255,255,255,0.5)",
  },
  primaryBtn: {
    marginTop: 8,
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 14,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryBtnText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
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

export default DriverServicesScreen;
