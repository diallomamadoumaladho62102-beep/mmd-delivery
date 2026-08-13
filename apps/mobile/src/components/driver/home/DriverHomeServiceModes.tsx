import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { DriverServicePreferences } from "../../../lib/driverServicePreferencesApi";
import { MMD_GOLD_CLASSIC, MMD_WHITE } from "../../../theme/mmdUi";

export type DriverServiceModeKey = "taxi" | "delivery" | "food" | "auto";

type Props = {
  preferences: DriverServicePreferences | null;
  onPressMode: (mode: DriverServiceModeKey) => void;
};

/** Figma Driver Home service chips — Food / Colis / Taxi (+ Auto). */
const MODES: Array<{
  key: DriverServiceModeKey;
  label: string;
  activeBg: string;
}> = [
  { key: "food", label: "Food", activeBg: "#DC2626" },
  { key: "delivery", label: "Colis", activeBg: MMD_GOLD_CLASSIC },
  { key: "taxi", label: "Taxi", activeBg: "#16A34A" },
  { key: "auto", label: "Auto", activeBg: "#7C3AED" },
];

function isModeActive(
  key: DriverServiceModeKey,
  preferences: DriverServicePreferences | null,
): boolean {
  if (!preferences) return false;
  if (key === "taxi") return preferences.taxi_rides_enabled === true;
  if (key === "delivery") return preferences.package_delivery_enabled === true;
  if (key === "food") return preferences.food_delivery_enabled === true;
  return (
    preferences.taxi_rides_enabled === true &&
    preferences.package_delivery_enabled === true &&
    preferences.food_delivery_enabled === true
  );
}

/**
 * Figma service bar: colored rounded chips with white labels.
 */
export function DriverHomeServiceModes({ preferences, onPressMode }: Props) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {MODES.map((mode) => {
        const active = isModeActive(mode.key, preferences);
        return (
          <TouchableOpacity
            key={mode.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={mode.label}
            onPress={() => onPressMode(mode.key)}
            activeOpacity={0.85}
            style={[
              styles.chip,
              { backgroundColor: mode.activeBg, opacity: active ? 1 : 0.45 },
            ]}
          >
            <Text style={styles.label} numberOfLines={1}>
              {mode.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  chip: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  label: {
    color: MMD_WHITE,
    fontSize: 14,
    fontWeight: "700",
  },
});
