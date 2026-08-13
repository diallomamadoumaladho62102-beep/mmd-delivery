import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NavigationInstruction } from "../../lib/navigationInstructions";
import { extractStreetName } from "../../lib/navigationInstructions";
import {
  laneIndicationGlyph,
  shouldShowLaneGuidance,
} from "../../lib/navigationLanes";
import {
  formatExitBadgeLabel,
  formatManeuverDistanceLabel,
  formatNavigationDistancePlain,
  formatRoundaboutExitLabel,
  formatThenPrefix,
  resolveNavigationLocale,
  resolveUnitSystem,
  type DistanceUnitSystem,
} from "../../lib/navigationLocale";
import {
  resolveHudTopPadding,
} from "../../lib/navigationSafeArea";
import { DriverNavigationTurnArrow } from "./DriverNavigationTurnArrow";

type Props = {
  visible: boolean;
  instruction: NavigationInstruction | null;
  locale?: string;
  /** ISO country (e.g. US) — drives ft/mi vs m/km without inventing data. */
  countryCode?: string | null;
};

/** Inner content breathing room — never an exterior panel margin. */
const CONTENT_GUTTER = 14;

/**
 * Edge-to-edge maneuver banner — background flush to top/left/right.
 * Safe-area insets pad only the inner content (Dynamic Island / status bar).
 */
export function DriverNavigationHud({
  visible,
  instruction,
  locale = "en",
  countryCode = null,
}: Props) {
  const insets = useSafeAreaInsets();
  const navLocale = resolveNavigationLocale(locale);
  const units: DistanceUnitSystem = resolveUnitSystem(countryCode, navLocale);

  if (!visible || !instruction) return null;

  const streetName = extractStreetName(instruction.title);
  const maneuverDistance = formatManeuverDistanceLabel(
    instruction.maneuverDistanceMeters,
    navLocale,
    units,
  );
  const showLanes = shouldShowLaneGuidance(
    instruction.lanes,
    instruction.maneuverDistanceMeters,
  );

  const thenStreet = instruction.secondaryTitle
    ? extractStreetName(instruction.secondaryTitle)
    : null;
  const thenDistance =
    instruction.secondaryDistanceMeters != null
      ? formatNavigationDistancePlain(instruction.secondaryDistanceMeters, units)
      : null;

  const exitBadge =
    instruction.exitNumber != null && String(instruction.exitNumber).trim()
      ? formatExitBadgeLabel(String(instruction.exitNumber).trim(), navLocale)
      : null;

  const roundaboutLine =
    instruction.roundaboutExit != null && instruction.roundaboutExit > 0
      ? formatRoundaboutExitLabel(instruction.roundaboutExit, navLocale)
      : null;

  const longStreet = streetName.length > 20;
  const contentPadLeft = CONTENT_GUTTER + Math.max(0, insets.left);
  const contentPadRight = CONTENT_GUTTER + Math.max(0, insets.right);
  // Safe-area pads content only — panel chrome stays flush to the screen edges.
  const contentPadTop = resolveHudTopPadding(insets.top);

  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={styles.card}>
        <View
          style={[
            styles.primary,
            longStreet && styles.primaryTall,
            {
              paddingTop: contentPadTop,
              paddingLeft: contentPadLeft,
              paddingRight: contentPadRight,
            },
          ]}
        >
          <View style={styles.arrowCol}>
            <DriverNavigationTurnArrow
              maneuverType={instruction.maneuverType}
              roundaboutExit={instruction.roundaboutExit ?? null}
            />
          </View>
          <View style={styles.primaryText}>
            <Text style={styles.distanceLabel} numberOfLines={1}>
              {maneuverDistance}
            </Text>
            <View style={styles.streetRow}>
              <Text
                style={[styles.streetName, longStreet && styles.streetNameLong]}
                numberOfLines={longStreet ? 2 : 1}
                adjustsFontSizeToFit
                minimumFontScale={0.68}
              >
                {streetName}
              </Text>
              {exitBadge ? (
                <View style={styles.exitBadge}>
                  <Text style={styles.exitBadgeText} numberOfLines={1}>
                    {exitBadge}
                  </Text>
                </View>
              ) : null}
            </View>
            {roundaboutLine ? (
              <Text style={styles.roundaboutLine} numberOfLines={1}>
                {roundaboutLine}
              </Text>
            ) : null}
          </View>
        </View>

        {thenStreet ? (
          <View
            style={[
              styles.thenRow,
              {
                paddingLeft: contentPadLeft,
                paddingRight: contentPadRight,
              },
            ]}
          >
            <View style={styles.thenLeft}>
              <DriverNavigationTurnArrow
                maneuverType={instruction.secondaryManeuverType}
                compact
              />
              <Text style={styles.thenText} numberOfLines={1}>
                {formatThenPrefix(navLocale)} {thenStreet}
              </Text>
            </View>
            {thenDistance ? (
              <Text style={styles.thenDistance} numberOfLines={1}>
                {thenDistance}
              </Text>
            ) : null}
          </View>
        ) : null}

        {showLanes && instruction.lanes ? (
          <View
            style={[
              styles.lanes,
              {
                paddingLeft: contentPadLeft,
                paddingRight: contentPadRight,
              },
            ]}
          >
            {instruction.lanes.map((lane, index) => (
              <View
                key={`lane-${index}`}
                style={[styles.laneChip, lane.valid && styles.laneChipValid]}
              >
                <Text style={[styles.laneGlyph, lane.valid && styles.laneGlyphValid]}>
                  {laneIndicationGlyph(lane.indications)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 40,
  },
  card: {
    width: "100%",
    overflow: "hidden",
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#003399",
    paddingBottom: 16,
    minHeight: 100,
  },
  primaryTall: {
    minHeight: 112,
    paddingBottom: 16,
  },
  arrowCol: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 12,
    gap: 4,
  },
  distanceLabel: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  streetRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 2,
  },
  streetName: {
    flex: 1,
    minWidth: 0,
    color: "#AABEE6",
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.1,
  },
  streetNameLong: {
    fontSize: 13,
    lineHeight: 18,
  },
  exitBadge: {
    marginTop: 4,
    backgroundColor: "#16A34A",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 120,
  },
  exitBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  roundaboutLine: {
    marginTop: 4,
    color: "rgba(255,255,255,0.88)",
    fontSize: 14,
    fontWeight: "700",
  },
  thenRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(0,33,107,0.9)",
    marginHorizontal: 16,
    marginTop: -6,
    marginBottom: 8,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 10,
    alignSelf: "center",
  },
  thenLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  thenText: {
    flex: 1,
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "500",
  },
  thenDistance: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "700",
  },
  lanes: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    position: "absolute",
    top: 14,
    alignSelf: "center",
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,26,89,0.9)",
    marginHorizontal: 100,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    minHeight: 30,
  },
  laneChip: {
    minWidth: 22,
    height: 22,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  laneChipValid: {
    backgroundColor: "transparent",
  },
  laneGlyph: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 16,
    fontWeight: "700",
  },
  laneGlyphValid: {
    color: "#33E566",
  },
});
