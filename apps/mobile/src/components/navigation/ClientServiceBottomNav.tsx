import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { MMD_FONT, MMD_NAVY, MMD_WHITE } from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type ClientServiceBottomNavActive = "home" | "orders" | "track" | "profile";

type Props = {
  /** Highlights the active tab (Figma Delivery Request bottom nav). */
  active?: ClientServiceBottomNavActive;
};

/**
 * Compact 4-tab bar matching Customer App / Delivery Request Figma
 * (Home · Orders · Track · Profile). Navigates to existing stack routes only.
 */
export function ClientServiceBottomNav({ active }: Props) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();

  const go = (route: keyof RootStackParamList) => {
    navigation.navigate(route as never);
  };

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}
      accessibilityRole="tablist"
    >
      <Tab
        emoji="🏠"
        label={t("client.home.tabs.home", "Home")}
        active={active === "home"}
        onPress={() => go("ClientHome")}
      />
      <Tab
        emoji="📦"
        label={t("client.home.tabs.orders", "Orders")}
        active={active === "orders"}
        onPress={() => go("ClientOrderHistory")}
      />
      <Tab
        emoji="🧭"
        label={t("client.delivery.tabs.track", "Track")}
        active={active === "track"}
        onPress={() => go("ClientOrderHistory")}
      />
      <Tab
        emoji="👤"
        label={t("client.profile.titleShort", "Profile")}
        active={active === "profile"}
        onPress={() => go("ClientProfile")}
      />
    </View>
  );
}

function Tab({
  emoji,
  label,
  active,
  onPress,
}: {
  emoji: string;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
    >
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.label, active ? styles.labelActive : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    backgroundColor: MMD_NAVY,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(226,232,240,0.35)",
    paddingHorizontal: 32,
    paddingTop: 16,
    minHeight: 84,
  },
  tab: {
    alignItems: "center",
    gap: 4,
    minWidth: 34,
  },
  emoji: {
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center",
  },
  label: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  labelActive: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});

export default ClientServiceBottomNav;
