import React from "react";
import { View, Text } from "react-native";
import type { NavigationInstruction } from "../../lib/navigationInstructions";
import { extractStreetName } from "../../lib/navigationInstructions";
import { formatManeuverDistanceLabel } from "../../lib/navigationLocale";
import { DriverNavigationTurnArrow } from "./DriverNavigationTurnArrow";

type Props = {
  visible: boolean;
  instruction: NavigationInstruction | null;
};

export function DriverNavigationHud({ visible, instruction }: Props) {
  if (!visible || !instruction) return null;

  const streetName = extractStreetName(instruction.title);
  const maneuverDistance = formatManeuverDistanceLabel(
    instruction.maneuverDistanceMeters,
    "fr",
  );

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        paddingTop: 36,
        paddingBottom: 12,
        paddingHorizontal: 12,
        backgroundColor: "#000000",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={{ width: 56, alignItems: "center" }}>
          <DriverNavigationTurnArrow maneuverType={instruction.maneuverType} />
        </View>

        <View style={{ flex: 1, paddingLeft: 2 }}>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: 20,
              fontWeight: "800",
              lineHeight: 24,
            }}
          >
            {maneuverDistance}
          </Text>
          <Text
            style={{
              color: "#00E5FF",
              fontSize: 30,
              fontWeight: "900",
              lineHeight: 34,
              marginTop: -1,
            }}
            numberOfLines={1}
          >
            {streetName}
          </Text>
        </View>
      </View>
    </View>
  );
}
