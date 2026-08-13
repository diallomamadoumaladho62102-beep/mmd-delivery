import React, { useMemo } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";

import { DriverHomeScreen } from "../screens/DriverHomeScreen";
import { DriverRevenueScreen } from "../screens/DriverRevenueScreen";
import { DriverInboxScreen } from "../screens/DriverInboxScreen";
import { DriverMenuScreen } from "../screens/DriverMenuScreen";
import {
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TEXT_MUTED_BLUE,
} from "../theme/mmdUi";

export type DriverTabParamList = {
  DriverHomeTab: undefined;
  DriverRevenueTab: undefined;
  DriverInboxTab: undefined;
  DriverMenuTab: undefined;
};

const Tab = createBottomTabNavigator<DriverTabParamList>();

/** Figma Driver Home bottom tabs — #002378 / gold active / muted blue inactive */
const TAB_BG = "#002378";
const TAB_ACTIVE = MMD_GOLD_CLASSIC;
const TAB_INACTIVE = MMD_TEXT_MUTED_BLUE;

function tabIcon(
  routeName: keyof DriverTabParamList,
  focused: boolean,
): keyof typeof Ionicons.glyphMap {
  if (routeName === "DriverHomeTab") return focused ? "home" : "home-outline";
  if (routeName === "DriverRevenueTab") return focused ? "cash" : "cash-outline";
  if (routeName === "DriverInboxTab")
    return focused ? "chatbubble" : "chatbubble-outline";
  return focused ? "menu" : "menu-outline";
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
          backgroundColor: TAB_BG,
          borderTopColor: "rgba(255,255,255,0.2)",
          borderTopWidth: 1,
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
          elevation: 0,
          shadowOpacity: 0,
        },
        tabBarActiveTintColor: TAB_ACTIVE,
        tabBarInactiveTintColor: TAB_INACTIVE,
        tabBarLabelStyle: {
          fontSize: 12,
          fontFamily: MMD_FONT.semibold,
          fontWeight: "600",
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
