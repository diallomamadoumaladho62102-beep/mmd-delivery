import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { textAlignStart } from "../../i18n/rtl";

type Stop = { key: string; address: string; order: number };

type Props = {
  pickupAddress: string;
  dropoffAddress: string;
  stops?: Stop[];
  distanceLabel: string | null;
  etaLabel: string | null;
  pickupCaption: string;
  dropoffCaption: string;
  distanceCaption: string;
  etaCaption: string;
};

export const TripRouteCard = React.memo(function TripRouteCard({
  pickupAddress,
  dropoffAddress,
  stops = [],
  distanceLabel,
  etaLabel,
  pickupCaption,
  dropoffCaption,
  distanceCaption,
  etaCaption,
}: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.left}>
        <View style={styles.row}>
          <View style={styles.rail}>
            <View style={[styles.dot, { backgroundColor: "#22C55E" }]} />
            <View style={styles.dash} />
            {stops.map((stop) => (
              <React.Fragment key={stop.key}>
                <View style={[styles.dotSmall, { backgroundColor: "#A855F7" }]} />
                <View style={styles.dash} />
              </React.Fragment>
            ))}
            <View style={[styles.dot, { backgroundColor: "#EF4444" }]} />
          </View>
          <View style={styles.addresses}>
            <Text style={styles.caption}>{pickupCaption}</Text>
            <Text style={styles.address} numberOfLines={3}>
              {pickupAddress || "—"}
            </Text>
            {stops.map((stop) => (
              <View key={stop.key} style={{ marginTop: 10 }}>
                <Text style={styles.caption}>
                  STOP {stop.order}
                </Text>
                <Text style={styles.addressMuted} numberOfLines={2}>
                  {stop.address}
                </Text>
              </View>
            ))}
            <Text style={[styles.caption, { marginTop: 12 }]}>
              {dropoffCaption}
            </Text>
            <Text style={styles.address} numberOfLines={3}>
              {dropoffAddress || "—"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <Ionicons name="navigate-outline" size={16} color="#60A5FA" />
          <Text style={styles.statValue} numberOfLines={1}>
            {distanceLabel ?? "—"}
          </Text>
          <Text style={styles.statLabel}>{distanceCaption}</Text>
        </View>
        <View style={styles.stat}>
          <Ionicons name="time-outline" size={16} color="#A78BFA" />
          <Text style={styles.statValue} numberOfLines={1}>
            {etaLabel ?? "—"}
          </Text>
          <Text style={styles.statLabel}>{etaCaption}</Text>
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: "#0F172A",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.14)",
    padding: 16,
  },
  left: {
    flex: 1.35,
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  rail: {
    width: 14,
    alignItems: "center",
    paddingTop: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dotSmall: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  dash: {
    width: 2,
    flexGrow: 1,
    minHeight: 18,
    backgroundColor: "rgba(148,163,184,0.35)",
    marginVertical: 3,
  },
  addresses: {
    flex: 1,
    minWidth: 0,
  },
  caption: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textAlign: textAlignStart(),
  },
  address: {
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 3,
    textAlign: textAlignStart(),
  },
  addressMuted: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 17,
    marginTop: 2,
    textAlign: textAlignStart(),
  },
  stats: {
    width: 92,
    justifyContent: "center",
    gap: 14,
  },
  stat: {
    alignItems: "center",
    gap: 3,
  },
  statValue: {
    color: "#F8FAFC",
    fontSize: 14,
    fontWeight: "800",
  },
  statLabel: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "600",
  },
});
