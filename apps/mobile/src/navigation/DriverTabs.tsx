import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

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

const TAB_GREEN = "#16A34A";
const TAB_MUTED = "#64748B";

function tabIcon(
  routeName: keyof DriverTabParamList,
  focused: boolean,
): keyof typeof Ionicons.glyphMap {
  if (routeName === "DriverHomeTab") return focused ? "home" : "home-outline";
  if (routeName === "DriverRevenueTab") return focused ? "cash" : "cash-outline";
  if (routeName === "DriverInboxTab") return focused ? "chatbubble" : "chatbubble-outline";
  return focused ? "grid" : "grid-outline";
}

export function DriverTabs() {
  const { t, i18n } = useTranslation();

  const tabKey = useMemo(
    () => `driver-tabs-${i18n.language}`,
    [i18n.language],
  );

  return (
    <Tab.Navigator
      id="driver-tabs"
      key={tabKey}
      initialRouteName="DriverHomeTab"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#E5E7EB",
          borderTopWidth: 1,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
          elevation: 8,
          shadowColor: "#0F172A",
          shadowOpacity: 0.08,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarActiveTintColor: TAB_GREEN,
        tabBarInactiveTintColor: TAB_MUTED,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
        },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons
            name={tabIcon(route.name, focused)}
            size={size ?? 22}
            color={color}
          />
        ),
      })}
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
