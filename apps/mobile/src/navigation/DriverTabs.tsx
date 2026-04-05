import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTranslation } from "react-i18next";

// Screens
import { DriverHomeScreen } from "../screens/DriverHomeScreen";
import { DriverRevenueScreen } from "../screens/DriverRevenueScreen";
import { DriverInboxScreen } from "../screens/DriverInboxScreen";
import { DriverMenuScreen } from "../screens/DriverMenuScreen";

export type DriverTabParamList = {
  DriverHomeTab: undefined;
  DriverRevenueTab: undefined;
  DriverInboxTab: undefined;
  DriverMenuTab: undefined;
};

const Tab = createBottomTabNavigator<DriverTabParamList>();

export function DriverTabs() {
  const { t, i18n } = useTranslation();

  // ✅ Remount des tabs quand la langue change (met à jour les labels/options)
  const tabKey = useMemo(() => `driver-tabs-${i18n.language}`, [i18n.language]);

  return (
    <Tab.Navigator
      // ✅ React Navigation v7: Navigator "id" est requis
      id="driver-tabs"
      // ✅ On garde ton remount clean quand la langue change
      key={tabKey}
      initialRouteName="DriverHomeTab"
      screenOptions={{
        headerShown: false,
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