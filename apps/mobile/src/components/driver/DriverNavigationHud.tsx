import React from "react";
import { View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NavigationInstruction } from "../../lib/navigationInstructions";
import { extractStreetName } from "../../lib/navigationInstructions";
import { formatManeuverDistanceLabel, resolveNavigationLocale } from "../../lib/navigationLocale";
import { resolveHudTopPadding, HUD_BOTTOM_PADDING } from "../../lib/navigationSafeArea";
import { DriverNavigationTurnArrow } from "./DriverNavigationTurnArrow";

type Props = {
  visible: boolean;
  instruction: NavigationInstruction | null;
  /** App locale (e.g. "fr", "en-US"). Normalized via resolveNavigationLocale. */
  locale?: string;
};

export function DriverNavigationHud({ visible, instruction, locale = "fr" }: Props) {
  const insets = useSafeAreaInsets();

  if (!visible || !instruction) return null;

  const streetName = extractStreetName(instruction.title);
  const maneuverDistance = formatManeuverDistanceLabel(
    instruction.maneuverDistanceMeters,
    resolveNavigationLocale(locale),
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
        paddingTop: resolveHudTopPadding(insets.top),
        paddingBottom: HUD_BOTTOM_PADDING,
        paddingHorizontal: 12 + Math.max(insets.left, insets.right),
        backgroundColor: "#000000",
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 6,
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
