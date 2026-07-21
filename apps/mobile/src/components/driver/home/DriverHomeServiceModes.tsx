import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { DriverServicePreferences } from "../../../lib/driverServicePreferencesApi";

export type DriverServiceModeKey = "taxi" | "delivery" | "food" | "auto";

type Props = {
  preferences: DriverServicePreferences | null;
  onPressMode: (mode: DriverServiceModeKey) => void;
};

const MODES: Array<{
  key: DriverServiceModeKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeColor: string;
  activeBg: string;
}> = [
  { key: "taxi", label: "Taxi", icon: "car-sport", activeColor: "#CA8A04", activeBg: "#FEF9C3" },
  { key: "delivery", label: "Delivery", icon: "bag-handle", activeColor: "#16A34A", activeBg: "#F0FDF4" },
  { key: "food", label: "Food", icon: "restaurant", activeColor: "#EA580C", activeBg: "#FFF7ED" },
  { key: "auto", label: "Auto", icon: "flash", activeColor: "#7C3AED", activeBg: "#F5F3FF" },
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
 * Mockup service bar: thin equal columns, icon above label, hairline dividers.
 */
export function DriverHomeServiceModes({ preferences, onPressMode }: Props) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {MODES.map((mode, index) => {
        const active = isModeActive(mode.key, preferences);
        return (
          <React.Fragment key={mode.key}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <TouchableOpacity
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={mode.label}
              onPress={() => onPressMode(mode.key)}
              activeOpacity={0.85}
              style={[styles.tab, active ? { backgroundColor: mode.activeBg } : null]}
            >
              <Ionicons
                name={mode.icon}
                size={16}
                color={active ? mode.activeColor : "#94A3B8"}
              />
              <Text
                style={[styles.label, { color: active ? "#0F172A" : "#64748B" }]}
                numberOfLines={1}
              >
                {mode.label}
              </Text>
            </TouchableOpacity>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 12,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E7EB",
    overflow: "hidden",
    height: 48,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E7EB",
    marginVertical: 10,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 1,
    paddingVertical: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
  },
});
