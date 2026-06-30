import React from "react";
import { View, Text, useWindowDimensions } from "react-native";
import type { NavigationInstruction } from "../../lib/navigationInstructions";
import {
  extractStreetName,
} from "../../lib/navigationInstructions";
import { formatFrenchSecondaryLine } from "../../lib/navigationLocale";
import {
  computeThenToastLayout,
} from "../../lib/driverNavigationVisual";

type Props = {
  instruction: NavigationInstruction | null;
  hasSpeedLimit?: boolean;
};

export function DriverNavigationThenToast({
  instruction,
  hasSpeedLimit = true,
}: Props) {
  const { width, height } = useWindowDimensions();
  const toast = computeThenToastLayout({ width, height }, hasSpeedLimit);

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
        left: toast.left,
        width: toast.maxWidth,
        bottom: toast.bottom,
        zIndex: 27,
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 9,
        backgroundColor: "rgba(0,0,0,0.88)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.12)",
        shadowColor: "#000",
        shadowOpacity: 0.22,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 4,
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
