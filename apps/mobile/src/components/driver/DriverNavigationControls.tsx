import React from "react";
import {
  ActionSheetIOS,
  Alert,
  Platform,
  View,
} from "react-native";
import type { NavigationRoute } from "../../lib/navigationService";
import {
  formatRouteAltLabel,
  formatTripDistance,
  type NavigationLocale,
} from "../../lib/navigationLocale";
import { MapFloatingButton } from "./map/MapFloatingButton";
import { NAV_SPACE } from "../../theme/navigationTheme";

type Props = {
  topOffset: number;
  voiceEnabled: boolean;
  trafficEnabled: boolean;
  navigationPaused: boolean;
  routes: NavigationRoute[];
  selectedRouteIndex: number;
  navLocale: NavigationLocale;
  onSelectRouteIndex: (index: number) => void;
  onToggleVoice: () => void;
  onToggleTraffic: () => void;
  onRecenter: () => void;
  onRouteOverview: () => void;
  onOpenOrderDetails: () => void;
  onTogglePause: () => void;
  onStopNavigation: () => void;
};

function formatRouteSummary(route: NavigationRoute, locale: NavigationLocale): string {
  return `${route.etaMinutes} min · ${formatTripDistance(route.distanceMeters, locale)}`;
}

function moreLabels(locale: NavigationLocale) {
  if (locale === "fr") {
    return {
      title: "Plus",
      pause: "Pause",
      resume: "Reprendre",
      overview: "Vue d'ensemble",
      details: "Détails commande",
      stop: "Arrêter la navigation",
      cancel: "Annuler",
      routes: "Itinéraires",
    };
  }
  if (locale === "es") {
    return {
      title: "Más",
      pause: "Pausa",
      resume: "Reanudar",
      overview: "Vista general",
      details: "Detalles del pedido",
      stop: "Finalizar navegación",
      cancel: "Cancelar",
      routes: "Rutas",
    };
  }
  return {
    title: "More",
    pause: "Pause",
    resume: "Resume",
    overview: "Route overview",
    details: "Order details",
    stop: "End navigation",
    cancel: "Cancel",
    routes: "Routes",
  };
}

/**
 * Floating map controls — Traffic / Voice / Center / More.
 * Equal circular targets, safe-area aware. Secondary actions live in More.
 */
export function DriverNavigationControls({
  topOffset,
  voiceEnabled,
  trafficEnabled,
  navigationPaused,
  routes,
  selectedRouteIndex,
  navLocale,
  onSelectRouteIndex,
  onToggleVoice,
  onToggleTraffic,
  onRecenter,
  onRouteOverview,
  onOpenOrderDetails,
  onTogglePause,
  onStopNavigation,
}: Props) {
  const labels = moreLabels(navLocale);

  const openMore = () => {
    const pauseLabel = navigationPaused ? labels.resume : labels.pause;
    const routeOptions =
      routes.length > 1
        ? routes.map((route, index) => {
            const tag = formatRouteAltLabel(index, navLocale);
            const selected = index === selectedRouteIndex ? " ✓" : "";
            return `${tag} · ${formatRouteSummary(route, navLocale)}${selected}`;
          })
        : [];

    const options = [
      pauseLabel,
      labels.overview,
      labels.details,
      ...routeOptions,
      labels.stop,
      labels.cancel,
    ];
    const stopIndex = options.length - 2;
    const cancelIndex = options.length - 1;
    const routeStartIndex = 3;

    const handleIndex = (buttonIndex: number) => {
      if (buttonIndex === 0) onTogglePause();
      else if (buttonIndex === 1) onRouteOverview();
      else if (buttonIndex === 2) onOpenOrderDetails();
      else if (buttonIndex === stopIndex) onStopNavigation();
      else if (
        buttonIndex >= routeStartIndex &&
        buttonIndex < stopIndex &&
        routes.length > 1
      ) {
        onSelectRouteIndex(buttonIndex - routeStartIndex);
      }
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: cancelIndex,
          destructiveButtonIndex: stopIndex,
          title: labels.title,
        },
        handleIndex,
      );
      return;
    }

    Alert.alert(
      labels.title,
      undefined,
      options.map((label, index) => {
        if (index === cancelIndex) {
          return { text: label, style: "cancel" as const };
        }
        return {
          text: label,
          style: index === stopIndex ? ("destructive" as const) : ("default" as const),
          onPress: () => handleIndex(index),
        };
      }),
    );
  };

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
      <MapFloatingButton
        scheme="day"
        icon="flash"
        caption={navLocale === "fr" ? "Trafic" : navLocale === "es" ? "Tráfico" : "Traffic"}
        state={trafficEnabled ? "active" : "default"}
        accessibilityLabel={
          trafficEnabled
            ? navLocale === "fr"
              ? "Masquer le trafic"
              : "Hide traffic"
            : navLocale === "fr"
              ? "Afficher le trafic"
              : "Show traffic"
        }
        onPress={onToggleTraffic}
      />

      <MapFloatingButton
        scheme="day"
        icon={voiceEnabled ? "volume-high" : "volume-mute"}
        caption={navLocale === "fr" ? "Voix" : navLocale === "es" ? "Voz" : "Voice"}
        state={voiceEnabled ? "active" : "default"}
        accessibilityLabel={
          voiceEnabled
            ? navLocale === "fr"
              ? "Couper le son"
              : "Mute voice"
            : navLocale === "fr"
              ? "Activer le son"
              : "Enable voice"
        }
        onPress={onToggleVoice}
      />

      <MapFloatingButton
        scheme="day"
        icon="locate"
        caption={
          navLocale === "fr" ? "Recentrer" : navLocale === "es" ? "Centrar" : "Center"
        }
        accessibilityLabel={
          navLocale === "fr" ? "Recentrer la carte" : "Center on vehicle"
        }
        onPress={onRecenter}
      />

      <MapFloatingButton
        scheme="day"
        icon="ellipsis-horizontal"
        caption={labels.title}
        accessibilityLabel={labels.title}
        onPress={openMore}
      />
    </View>
  );
}
