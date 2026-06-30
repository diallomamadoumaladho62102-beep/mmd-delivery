import React from "react";
import { View, Text, TouchableOpacity } from "react-native";

type Props = {
  topOffset: number;
  voiceEnabled: boolean;
  navigationPaused: boolean;
  onToggleVoice: () => void;
  onRecenter: () => void;
  onRouteOverview: () => void;
  onOpenOrderDetails: () => void;
  onTogglePause: () => void;
  onStopNavigation: () => void;
};

export function DriverNavigationControls({
  topOffset,
  voiceEnabled,
  navigationPaused,
  onToggleVoice,
  onRecenter,
  onRouteOverview,
  onOpenOrderDetails,
  onTogglePause,
  onStopNavigation,
}: Props) {
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
      <TouchableOpacity onPress={onRecenter} activeOpacity={0.86} style={controlStyle()}>
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

function controlStyle(backgroundColor = "rgba(15,23,42,0.82)") {
  return {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.14)",
    marginBottom: 9,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  };
}
