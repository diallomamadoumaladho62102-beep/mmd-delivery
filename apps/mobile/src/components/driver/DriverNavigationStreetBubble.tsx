import React from "react";
import { View, Text } from "react-native";
import { extractStreetName } from "../../lib/navigationInstructions";

type Props = {
  streetName: string;
};

export function DriverNavigationStreetBubbleLabel({ streetName }: Props) {
  const label = extractStreetName(streetName);

  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          backgroundColor: "#1B3F63",
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "rgba(0,229,255,0.22)",
          shadowColor: "#000000",
          shadowOpacity: 0.45,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 8,
        }}
      >
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 15,
            fontWeight: "800",
            letterSpacing: 0.2,
          }}
        >
          {label}
        </Text>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 8,
          borderRightWidth: 8,
          borderTopWidth: 9,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: "#1B3F63",
        }}
      />
    </View>
  );
}
