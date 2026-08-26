import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import {
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_NAVY,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList>;

export type ClientServiceBottomNavActive = "home" | "orders" | "track" | "profile";

type Props = {
  /** Highlights the active tab (Figma Delivery Request bottom nav). */
  active?: ClientServiceBottomNavActive;
  /** `glass` matches taxi Figma (translucent bar). */
  appearance?: "navy" | "glass";
  /** Active tab color — gold on Quote, green on Tracking. */
  accent?: "gold" | "green";
  /** Full-width edge bar (Tracking) vs floating pill (Quote). */
  layout?: "floating" | "edge";
};

/**
 * Compact 4-tab bar matching Customer App / Delivery Request Figma
 * (Home · Orders · Track · Profile). Navigates to existing stack routes only.
 */
export function ClientServiceBottomNav({
  active,
  appearance = "navy",
  accent = "gold",
  layout = "floating",
}: Props) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();

  const go = (
    route: keyof RootStackParamList,
    params?: RootStackParamList[typeof route],
  ) => {
    if (params !== undefined) {
      (navigation.navigate as (name: string, p?: object) => void)(route, params);
      return;
    }
    navigation.navigate(route as never);
  };

  const glass = appearance === "glass";

  return (
    <View
      style={[
        styles.bar,
        glass ? styles.barGlass : null,
        glass && layout === "edge" ? styles.barGlassEdge : null,
        { paddingBottom: Math.max(insets.bottom, 10) },
      ]}
      accessibilityRole="tablist"
    >
      <Tab
        emoji="🏠"
        label={t("client.home.tabs.home", "Home")}
        active={active === "home"}
        goldActive={glass && accent !== "green"}
        greenActive={glass && accent === "green"}
        onPress={() => go("ClientHome")}
      />
      <Tab
        emoji="📦"
        label={t("client.home.tabs.orders", "Orders")}
        active={active === "orders"}
        goldActive={glass && accent !== "green"}
        greenActive={glass && accent === "green"}
        onPress={() => go("ClientOrderHistory")}
      />
      <Tab
        emoji="📍"
        label={t("client.delivery.tabs.track", "Track")}
        active={active === "track"}
        goldActive={glass && accent !== "green"}
        greenActive={glass && accent === "green"}
        onPress={() => go("ClientOrderHistory", { focusActive: true })}
      />
      <Tab
        emoji="👤"
        label={t("client.profile.titleShort", "Profile")}
        active={active === "profile"}
        goldActive={glass && accent !== "green"}
        greenActive={glass && accent === "green"}
        onPress={() => go("ClientProfile")}
      />
    </View>
  );
}

function Tab({
  emoji,
  label,
  active,
  goldActive,
  greenActive,
  onPress,
}: {
  emoji: string;
  label: string;
  active?: boolean;
  goldActive?: boolean;
  greenActive?: boolean;
  onPress: () => void;
}) {
  const activeStyle = greenActive
    ? styles.labelActiveGreen
    : goldActive
      ? styles.labelActiveGold
      : styles.labelActive;
  return (
    <Pressable
      onPress={onPress}
      style={styles.tab}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
    >
      <Text style={styles.emoji}>{emoji}</Text>
      <Text style={[styles.label, active ? activeStyle : null]}>{label}</Text>
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
  barGlass: {
    backgroundColor: MMD_GLASS,
    borderTopWidth: 1,
    borderTopColor: "rgba(212,175,55,0.3)",
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.3)",
    paddingHorizontal: 24,
  },
  barGlassEdge: {
    marginHorizontal: 0,
    marginBottom: 0,
    borderRadius: 0,
    borderWidth: 0,
    borderTopWidth: 1,
    borderColor: "transparent",
    borderTopColor: "rgba(212,175,55,0.45)",
    paddingHorizontal: 24,
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
  labelActiveGold: {
    color: MMD_GOLD_CLASSIC,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  labelActiveGreen: {
    color: MMD_TAXI_GREEN,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
});

export default ClientServiceBottomNav;
