import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { useTranslation } from "react-i18next";

import type { RootStackParamList } from "../../navigation/AppNavigator";
import { MMD_BLUE, MMD_WHITE } from "../../theme/mmdUi";

type TabKey = "taxi" | "restaurants" | "colis";
type Nav = NativeStackNavigationProp<RootStackParamList>;

export function GuineaServiceTabs({ active }: { active: TabKey }) {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const tabs: Array<{
    key: TabKey;
    icon: string;
    label: string;
    route: keyof RootStackParamList;
  }> = [
    { key: "taxi", icon: "🚕", label: t("guineaMarket.tabsTaxi"), route: "TaxiHome" },
    {
      key: "restaurants",
      icon: "🍽️",
      label: t("guineaMarket.tabsRestaurants"),
      route: "ClientRestaurantList",
    },
    { key: "colis", icon: "📦", label: t("guineaMarket.tabsParcels"), route: "DeliveryRequest" },
  ];

  return (
    <View style={styles.row} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              navigation.navigate(tab.route as never);
            }}
            style={[styles.tab, selected && styles.tabSelected]}
          >
            <Text style={styles.icon}>{tab.icon}</Text>
            <Text style={[styles.label, selected && styles.labelSelected]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    backgroundColor: MMD_WHITE,
    borderRadius: 16,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: "#D6DEEA",
  },
  tab: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  tabSelected: {
    backgroundColor: MMD_BLUE,
  },
  icon: {
    fontSize: 16,
  },
  label: {
    marginTop: 2,
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  labelSelected: {
    color: MMD_WHITE,
  },
});
