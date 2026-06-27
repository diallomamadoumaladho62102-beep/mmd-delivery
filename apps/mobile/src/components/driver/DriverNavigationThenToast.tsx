import React from "react";
import { View, Text } from "react-native";
import type { NavigationInstruction } from "../../lib/navigationInstructions";
import {
  extractStreetName,
} from "../../lib/navigationInstructions";
import { formatFrenchSecondaryLine } from "../../lib/navigationLocale";

type Props = {
  instruction: NavigationInstruction | null;
};

export function DriverNavigationThenToast({ instruction }: Props) {
  if (!instruction?.secondaryTitle) return null;

  const streetName = extractStreetName(instruction.secondaryTitle);
  const line = formatFrenchSecondaryLine(
    instruction.secondaryManeuverType,
    instruction.secondaryTitle,
    streetName,
  );

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: 108,
        zIndex: 27,
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 9,
        backgroundColor: "rgba(0,0,0,0.9)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      <Text
        style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}
        numberOfLines={2}
      >
        {line}
      </Text>
    </View>
  );
}
