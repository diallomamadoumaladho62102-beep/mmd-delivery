import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { GpsQualityStatus, RouteEngineStatus } from "../../lib/driverNavigation/types";
import type { NetworkQuality } from "../../hooks/useNetworkStatus";
import type { PreviewQaStatus } from "../../lib/driverNavigationPreview";

export type NavigationStatusBanner = {
  message: string;
  tone: "info" | "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
};

type ResolveParams = {
  navigationPaused: boolean;
  gpsStatus: GpsQualityStatus;
  routeStatus: RouteEngineStatus;
  networkQuality: NetworkQuality;
};

/** Preview QA — force un bandeau d'état sans GPS/réseau réel. */
export function previewStatusBannerFromQa(
  status: PreviewQaStatus,
): NavigationStatusBanner {
  switch (status) {
    case "gps_lost":
      return {
        message: "Signal GPS perdu — recherche en cours",
        tone: "danger",
      };
    case "gps_weak":
      return {
        message: "Signal GPS faible",
        tone: "warning",
      };
    case "network_offline":
      return {
        message: "Réseau indisponible",
        tone: "danger",
      };
    case "network_weak":
      return {
        message: "Connexion réseau faible",
        tone: "warning",
      };
    case "rerouting":
      return {
        message: "Recalcul de l'itinéraire…",
        tone: "info",
      };
    case "stale":
      return {
        message: "Itinéraire obsolète — dernière route conservée",
        tone: "warning",
      };
    default:
      return {
        message: "Signal GPS faible",
        tone: "warning",
      };
  }
}

export function resolveNavigationStatusBanner(
  params: ResolveParams,
): NavigationStatusBanner | null {
  const { navigationPaused, gpsStatus, routeStatus, networkQuality } = params;

  if (navigationPaused) {
    return {
      message: "Navigation en pause",
      tone: "info",
      actionLabel: "Reprendre",
    };
  }

  if (gpsStatus === "lost") {
    return {
      message: "Signal GPS perdu — recherche en cours",
      tone: "danger",
    };
  }

  if (routeStatus === "rerouting") {
    return {
      message: "Recalcul de l'itinéraire…",
      tone: "info",
    };
  }

  if (routeStatus === "stale") {
    return {
      message: "Itinéraire obsolète — dernière route conservée",
      tone: "warning",
    };
  }

  if (gpsStatus === "degraded") {
    return {
      message: "Signal GPS faible",
      tone: "warning",
    };
  }

  if (networkQuality === "offline") {
    return {
      message: "Réseau indisponible",
      tone: "danger",
    };
  }

  if (networkQuality === "weak") {
    return {
      message: "Connexion réseau faible",
      tone: "warning",
    };
  }

  return null;
}

type Props = {
  banner: NavigationStatusBanner | null;
  onResume?: () => void;
  /** Distance from the top of the screen (below the safe-area HUD). */
  topOffset?: number;
};

const TONE_STYLES = {
  info: {
    backgroundColor: "rgba(15,23,42,0.94)",
    borderColor: "rgba(96,165,250,0.45)",
    textColor: "#DBEAFE",
  },
  warning: {
    backgroundColor: "rgba(69,26,3,0.94)",
    borderColor: "rgba(251,191,36,0.45)",
    textColor: "#FDE68A",
  },
  danger: {
    backgroundColor: "rgba(69,10,10,0.94)",
    borderColor: "rgba(248,113,113,0.45)",
    textColor: "#FECACA",
  },
} as const;

export function DriverNavigationStatusBanner({ banner, onResume, topOffset = 118 }: Props) {
  if (!banner) return null;

  const tone = TONE_STYLES[banner.tone];

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: 12,
        right: 12,
        top: topOffset,
        zIndex: 38,
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: tone.backgroundColor,
        borderWidth: 1,
        borderColor: tone.borderColor,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <Text
        style={{ color: tone.textColor, fontSize: 12, fontWeight: "800", flex: 1 }}
        numberOfLines={2}
      >
        {banner.message}
      </Text>
      {banner.actionLabel && onResume ? (
        <TouchableOpacity
          onPress={onResume}
          activeOpacity={0.88}
          style={{
            marginLeft: 10,
            paddingHorizontal: 10,
            paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.12)",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "900" }}>
            {banner.actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
