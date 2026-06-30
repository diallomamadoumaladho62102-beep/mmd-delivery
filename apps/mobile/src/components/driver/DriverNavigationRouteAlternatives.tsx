import React from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import type { NavigationRoute } from "../../lib/navigationService";
import {
  formatRouteAltLabel,
  formatTripDistance,
  type NavigationLocale,
} from "../../lib/navigationLocale";

type Props = {
  routes: NavigationRoute[];
  selectedIndex: number;
  topOffset: number;
  navLocale: NavigationLocale;
  onSelect: (index: number) => void;
};

function formatRouteSummary(route: NavigationRoute, locale: NavigationLocale): string {
  return `${route.etaMinutes} min · ${formatTripDistance(route.distanceMeters, locale)}`;
}

export function DriverNavigationRouteAlternatives({
  routes,
  selectedIndex,
  topOffset,
  navLocale,
  onSelect,
}: Props) {
  if (routes.length <= 1) return null;

  return (
    <View
      style={{
        position: "absolute",
        left: 10,
        right: 56,
        top: topOffset,
        zIndex: 35,
      }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {routes.map((route, index) => {
          const selected = index === selectedIndex;
          return (
            <TouchableOpacity
              key={`route-alt-${index}`}
              onPress={() => onSelect(index)}
              activeOpacity={0.9}
              style={{
                marginRight: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 10,
                backgroundColor: selected
                  ? "rgba(37,99,235,0.92)"
                  : "rgba(15,23,42,0.84)",
                borderWidth: 1,
                borderColor: selected
                  ? "rgba(96,165,250,0.55)"
                  : "rgba(0,0,0,0.12)",
                shadowColor: "#000",
                shadowOpacity: 0.15,
                shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
                elevation: 3,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 10, fontWeight: "900" }}>
                {formatRouteAltLabel(index, navLocale)}
              </Text>
              <Text
                style={{
                  color: selected ? "#DBEAFE" : "#94A3B8",
                  fontSize: 10,
                  fontWeight: "700",
                  marginTop: 1,
                }}
              >
                {formatRouteSummary(route, navLocale)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
