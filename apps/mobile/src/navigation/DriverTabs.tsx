import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTranslation } from "react-i18next";

// Screens
import { DriverHomeScreen } from "../screens/DriverHomeScreen";
import { DriverRevenueScreen } from "../screens/DriverRevenueScreen";
import { DriverInboxScreen } from "../screens/DriverInboxScreen";
import { DriverMenuScreen } from "../screens/DriverMenuScreen";
import { APP_COLORS } from "../theme/appTheme";

export type DriverTabParamList = {
  DriverHomeTab: undefined;
  DriverRevenueTab: undefined;
  DriverInboxTab: undefined;
  DriverMenuTab: undefined;
};

const Tab = createBottomTabNavigator<DriverTabParamList>();

export function DriverTabs() {
  const { t, i18n } = useTranslation();

  // ✅ Remount des tabs quand la langue change
  const tabKey = useMemo(
    () => `driver-tabs-${i18n.language}`,
    [i18n.language]
  );

  return (
    <Tab.Navigator
      id="driver-tabs"
      key={tabKey}
      initialRouteName="DriverHomeTab"
      screenOptions={{
        headerShown: false,

        // ✅ Style premium sombre MMD
        tabBarStyle: {
          backgroundColor: "rgba(2,6,23,0.98)",
          borderTopColor: "rgba(139,92,246,0.22)",
          borderTopWidth: 1,
          height: 72,
          paddingTop: 8,
          paddingBottom: 10,
        },

        // ✅ Couleurs
        tabBarActiveTintColor: APP_COLORS.accent,
        tabBarInactiveTintColor: APP_COLORS.textMuted,

        // ✅ Texte
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: "800",
        },
      }}
    >
      <Tab.Screen
        name="DriverHomeTab"
        component={DriverHomeScreen}
        options={{
          tabBarLabel: t("driver.tabs.home", "Home"),
        }}
      />

      <Tab.Screen
        name="DriverRevenueTab"
        component={DriverRevenueScreen}
        options={{
          tabBarLabel: t("driver.tabs.revenue", "Earnings"),
        }}
      />

      <Tab.Screen
        name="DriverInboxTab"
        component={DriverInboxScreen}
        options={{
          tabBarLabel: t("driver.tabs.inbox", "Inbox"),
        }}
      />

      <Tab.Screen
        name="DriverMenuTab"
        component={DriverMenuScreen}
        options={{
          tabBarLabel: t("driver.tabs.menu", "Menu"),
        }}
      />
    </Tab.Navigator>
  );
}