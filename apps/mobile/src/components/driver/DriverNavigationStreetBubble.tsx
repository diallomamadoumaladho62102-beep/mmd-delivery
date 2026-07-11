import React from "react";
import { View, Text } from "react-native";
import { extractStreetName } from "../../lib/navigationInstructions";

type Props = {
  streetName: string;
};

export function DriverNavigationStreetBubbleLabel({ streetName }: Props) {
  const label = extractStreetName(streetName);

  // Rounded pill only — no CSS border triangle pointer. The previous downward
  // triangle (borderTopColor) rendered as a dark "pointe" over the map on both
  // Android and iOS; it is removed at the source so it cannot reappear.
  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          backgroundColor: "#1B3F63",
          paddingHorizontal: 16,
          paddingVertical: 8,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "rgba(0,229,255,0.22)",
          shadowColor: "#000000",
          shadowOpacity: 0.28,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 6,
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
    </View>
  );
}
