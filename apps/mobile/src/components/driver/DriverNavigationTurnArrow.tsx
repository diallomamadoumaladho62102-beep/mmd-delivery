import React from "react";
import { View } from "react-native";

export function DriverNavigationTurnArrow({
  maneuverType,
}: {
  maneuverType?: string;
}) {
  const type = maneuverType ?? "";

  if (type.includes("left")) {
    return (
      <View style={{ width: 52, height: 52, justifyContent: "center" }}>
        <View
          style={{
            position: "absolute",
            left: 12,
            top: 24,
            width: 30,
            height: 7,
            borderRadius: 2,
            backgroundColor: "#FFFFFF",
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 12,
            top: 8,
            width: 7,
            height: 28,
            borderRadius: 2,
            backgroundColor: "#FFFFFF",
          }}
        />
        <View
          style={{
            position: "absolute",
            left: 5,
            top: 16,
            width: 0,
            height: 0,
            borderTopWidth: 10,
            borderBottomWidth: 10,
            borderRightWidth: 14,
            borderTopColor: "transparent",
            borderBottomColor: "transparent",
            borderRightColor: "#FFFFFF",
          }}
        />
      </View>
    );
  }

  if (type.includes("right")) {
    return (
      <View style={{ transform: [{ scaleX: -1 }] }}>
        <DriverNavigationTurnArrow maneuverType="turn-left" />
      </View>
    );
  }

  return (
    <View
      style={{
        width: 52,
        height: 52,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 7,
          height: 32,
          borderRadius: 2,
          backgroundColor: "#FFFFFF",
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 4,
          width: 0,
          height: 0,
          borderLeftWidth: 10,
          borderRightWidth: 10,
          borderBottomWidth: 16,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderBottomColor: "#FFFFFF",
        }}
      />
    </View>
  );
}
