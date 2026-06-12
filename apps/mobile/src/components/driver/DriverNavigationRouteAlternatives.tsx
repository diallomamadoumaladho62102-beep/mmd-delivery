import React from "react";
import { View, Text, TouchableOpacity, ScrollView } from "react-native";
import type { NavigationRoute } from "../../lib/navigationService";

type Props = {
  routes: NavigationRoute[];
  selectedIndex: number;
  onSelect: (index: number) => void;
};

function formatRouteSummary(route: NavigationRoute): string {
  const miles = route.distanceMeters / 1609.344;
  return `${route.etaMinutes} min · ${miles.toFixed(1)} mi`;
}

export function DriverNavigationRouteAlternatives({
  routes,
  selectedIndex,
  onSelect,
}: Props) {
  if (routes.length <= 1) return null;

  return (
    <View
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        top: 210,
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
                marginRight: 10,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 16,
                backgroundColor: selected
                  ? "rgba(37,99,235,0.92)"
                  : "rgba(2,6,23,0.88)",
                borderWidth: 1,
                borderColor: selected
                  ? "rgba(147,197,253,0.8)"
                  : "rgba(148,163,184,0.24)",
              }}
            >
              <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>
                {index === 0 ? "Fastest" : `Alt ${index}`}
              </Text>
              <Text
                style={{
                  color: selected ? "#DBEAFE" : "#CBD5E1",
                  fontSize: 11,
                  fontWeight: "700",
                  marginTop: 3,
                }}
              >
                {formatRouteSummary(route)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}
