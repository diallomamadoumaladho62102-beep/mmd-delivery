import React from "react";
import { View, Text } from "react-native";

type Props = {
  alert: { message: string } | null;
};

/** Pill noire — alertes MMD uniquement. */
export function DriverNavigationAlertPill({ alert }: Props) {
  if (!alert?.message) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 16,
        right: 16,
        bottom: 112,
        zIndex: 28,
        alignItems: "center",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: "#111111",
          borderRadius: 28,
          paddingHorizontal: 18,
          paddingVertical: 14,
          maxWidth: "100%",
          shadowColor: "#000000",
          shadowOpacity: 0.35,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        }}
      >
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: "rgba(59,130,246,0.25)",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          <Text style={{ fontSize: 16 }}>⚠</Text>
        </View>
        <Text
          style={{
            flex: 1,
            color: "#FFFFFF",
            fontSize: 15,
            fontWeight: "600",
            lineHeight: 20,
          }}
          numberOfLines={2}
        >
          {alert.message}
        </Text>
      </View>
    </View>
  );
}
