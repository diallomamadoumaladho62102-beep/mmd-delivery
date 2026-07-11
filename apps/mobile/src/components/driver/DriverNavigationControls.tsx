import React from "react";
import { View } from "react-native";
import type { NavigationRoute } from "../../lib/navigationService";
import {
  formatRouteAltLabel,
  formatTripDistance,
  type NavigationLocale,
} from "../../lib/navigationLocale";
import { MapFloatingButton } from "./map/MapFloatingButton";
import { NAV_SPACE, type NavColorScheme } from "../../theme/navigationTheme";

type Props = {
  topOffset: number;
  voiceEnabled: boolean;
  navigationPaused: boolean;
  routes: NavigationRoute[];
  selectedRouteIndex: number;
  navLocale: NavigationLocale;
  scheme?: NavColorScheme;
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

/**
 * Premium floating map controls — a single coherent button family (recenter,
 * voice, pause, overview, details, stop + route alternatives) with accessible
 * tactile targets, animated press, clear active/alert states and day/night
 * contrast. Positioned to never collide with the HUD, driver arrow or bottom
 * bar (topOffset is safe-area aware).
 */
export function DriverNavigationControls({
  topOffset,
  voiceEnabled,
  navigationPaused,
  routes,
  selectedRouteIndex,
  navLocale,
  scheme = "night",
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
        right: NAV_SPACE.md,
        top: topOffset,
        zIndex: 30,
        alignItems: "center",
        gap: NAV_SPACE.sm,
      }}
    >
      {showRouteAlts
        ? routes.map((route, index) => {
            const selected = index === selectedRouteIndex;
            const label = formatRouteAltLabel(index, navLocale);
            return (
              <MapFloatingButton
                key={`route-alt-${index}`}
                compact
                scheme={scheme}
                state={selected ? "active" : "default"}
                icon={index === 0 ? "flash" : "navigate-outline"}
                accessibilityLabel={`${label}, ${formatRouteSummary(route, navLocale)}`}
                onPress={() => onSelectRouteIndex(index)}
              />
            );
          })
        : null}

      <MapFloatingButton
        scheme={scheme}
        icon="locate"
        accessibilityLabel="Recentrer la carte"
        onPress={onRecenter}
      />

      <MapFloatingButton
        scheme={scheme}
        icon={voiceEnabled ? "volume-high" : "volume-mute"}
        state={voiceEnabled ? "active" : "default"}
        accessibilityLabel={voiceEnabled ? "Couper le son" : "Activer le son"}
        onPress={onToggleVoice}
      />

      <MapFloatingButton
        scheme={scheme}
        icon={navigationPaused ? "play" : "pause"}
        state={navigationPaused ? "alert" : "default"}
        accessibilityLabel={navigationPaused ? "Reprendre la navigation" : "Mettre en pause"}
        onPress={onTogglePause}
      />

      <MapFloatingButton
        scheme={scheme}
        icon="map-outline"
        accessibilityLabel="Vue d'ensemble de l'itinéraire"
        onPress={onRouteOverview}
      />

      <MapFloatingButton
        scheme={scheme}
        icon="list"
        accessibilityLabel="Détails de la commande"
        onPress={onOpenOrderDetails}
      />

      <MapFloatingButton
        scheme={scheme}
        icon="close"
        state="alert"
        accessibilityLabel="Arrêter la navigation"
        onPress={onStopNavigation}
      />
    </View>
  );
}
