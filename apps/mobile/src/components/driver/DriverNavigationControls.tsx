import React from "react";
import { View, Text, TouchableOpacity } from "react-native";

type Props = {
  topOffset: number;
  voiceEnabled: boolean;
  onToggleVoice: () => void;
  onRecenter: () => void;
  onRouteOverview: () => void;
  onOpenOrderDetails: () => void;
};

export function DriverNavigationControls({
  topOffset,
  voiceEnabled,
  onToggleVoice,
  onRecenter,
  onRouteOverview,
  onOpenOrderDetails,
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

      <TouchableOpacity onPress={onRouteOverview} activeOpacity={0.86} style={controlStyle()}>
        <Text style={{ color: "#CBD5E1", fontSize: 11, fontWeight: "600" }}>▭</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={onOpenOrderDetails} activeOpacity={0.86} style={controlStyle()}>
        <Text style={{ color: "#CBD5E1", fontSize: 11, fontWeight: "600" }}>☰</Text>
      </TouchableOpacity>
    </View>
  );
}

function controlStyle(backgroundColor = "rgba(0,0,0,0.42)") {
  return {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 4,
  };
}
