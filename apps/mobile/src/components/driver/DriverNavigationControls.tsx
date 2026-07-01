import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { NavigationRoute } from "../../lib/navigationService";
import {
  formatRouteAltLabel,
  formatTripDistance,
  type NavigationLocale,
} from "../../lib/navigationLocale";

type Props = {
  topOffset: number;
  voiceEnabled: boolean;
  navigationPaused: boolean;
  routes: NavigationRoute[];
  selectedRouteIndex: number;
  navLocale: NavigationLocale;
  onSelectRouteIndex: (index: number) => void;
  onToggleVoice: () => void;
  onRecenter: () => void;
  onRouteOverview: () => void;
  onOpenOrderDetails: () => void;
  onTogglePause: () => void;
  onStopNavigation: () => void;
};

function formatRouteSummary(route: NavigationRoute, locale: NavigationLocale): string {
  return `${route.etaMinutes} min · ${formatTripDistance(route.distanceMeters, locale)}`;
}

function routeAltIcon(index: number): string {
  if (index === 0) return "⚡";
  return `A${index}`;
}

export function DriverNavigationControls({
  topOffset,
  voiceEnabled,
  navigationPaused,
  routes,
  selectedRouteIndex,
  navLocale,
  onSelectRouteIndex,
  onToggleVoice,
  onRecenter,
  onRouteOverview,
  onOpenOrderDetails,
  onTogglePause,
  onStopNavigation,
}: Props) {
  const showRouteAlts = routes.length > 1;

  return (
    <View
      style={{
        position: "absolute",
        right: 6,
        top: topOffset,
        zIndex: 30,
        alignItems: "center",
      }}
    >
      {showRouteAlts
        ? routes.map((route, index) => {
            const selected = index === selectedRouteIndex;
            const label = formatRouteAltLabel(index, navLocale);
            const summary = formatRouteSummary(route, navLocale);
            return (
              <TouchableOpacity
                key={`route-alt-${index}`}
                onPress={() => onSelectRouteIndex(index)}
                activeOpacity={0.86}
                accessibilityRole="button"
                accessibilityLabel={`${label}, ${summary}`}
                accessibilityState={{ selected }}
                style={controlStyle(
                  selected ? "rgba(37,99,235,0.92)" : undefined,
                  selected ? "rgba(96,165,250,0.55)" : undefined,
                )}
              >
                <Text
                  style={{
                    color: selected ? "#FFFFFF" : "#CBD5E1",
                    fontSize: index === 0 ? 13 : 9,
                    fontWeight: "800",
                  }}
                >
                  {routeAltIcon(index)}
                </Text>
              </TouchableOpacity>
            );
          })
        : null}

      {showRouteAlts ? <View style={{ height: 6 }} /> : null}

      <TouchableOpacity
        onPress={onRecenter}
        activeOpacity={0.86}
        accessibilityRole="button"
        style={controlStyle()}
      >
        <Text style={{ color: "#CBD5E1", fontSize: 13, fontWeight: "600" }}>⌖</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onToggleVoice}
        activeOpacity={0.86}
        style={controlStyle(voiceEnabled ? undefined : "rgba(69,10,10,0.55)")}
      >
        <Text style={{ color: "#CBD5E1", fontSize: 12, fontWeight: "600" }}>
          {voiceEnabled ? "🔊" : "🔇"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onTogglePause}
        activeOpacity={0.86}
        style={controlStyle(navigationPaused ? "rgba(30,58,138,0.72)" : undefined)}
      >
        <Text style={{ color: "#CBD5E1", fontSize: 11, fontWeight: "600" }}>
          {navigationPaused ? "▶" : "⏸"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onRouteOverview} activeOpacity={0.86} style={controlStyle()}>
        <Text style={{ color: "#CBD5E1", fontSize: 11, fontWeight: "600" }}>▭</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onOpenOrderDetails} activeOpacity={0.86} style={controlStyle()}>
        <Text style={{ color: "#CBD5E1", fontSize: 11, fontWeight: "600" }}>☰</Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={onStopNavigation}
        activeOpacity={0.86}
        style={controlStyle("rgba(127,29,29,0.72)")}
      >
        <Text style={{ color: "#FECACA", fontSize: 11, fontWeight: "900" }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

function controlStyle(
  backgroundColor = "rgba(15,23,42,0.82)",
  borderColor = "rgba(0,0,0,0.14)",
) {
  return {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor,
    marginBottom: 9,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  };
}
