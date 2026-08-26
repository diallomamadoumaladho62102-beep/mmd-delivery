import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { textAlignStart } from "../../i18n/rtl";
import {
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_GOLD_CLASSIC_BORDER,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Stop = { key: string; address: string; order: number };

type Props = {
  pickupAddress: string;
  dropoffAddress: string;
  stops?: Stop[];
  distanceLabel: string | null;
  etaLabel: string | null;
  durationLabel?: string | null;
  pickupCaption: string;
  dropoffCaption: string;
  distanceCaption: string;
  etaCaption: string;
  stopCaption?: (order: number) => string;
  metaLine?: string | null;
};

export const TripRouteCard = React.memo(function TripRouteCard({
  pickupAddress,
  dropoffAddress,
  stops = [],
  distanceLabel,
  etaLabel,
  durationLabel,
  pickupCaption,
  dropoffCaption,
  distanceCaption,
  etaCaption,
  stopCaption,
  metaLine,
}: Props) {
  const fallbackMeta = [
    distanceLabel ? `${distanceCaption}: ${distanceLabel}` : null,
    durationLabel ?? (etaLabel ? `${etaCaption} ${etaLabel}` : null),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <View style={styles.card}>
      <View style={styles.block}>
        <Text style={styles.caption}>{pickupCaption}</Text>
        <Text style={styles.address} numberOfLines={3}>
          {pickupAddress || "—"}
        </Text>
      </View>
      {stops.map((stop) => (
        <View key={stop.key} style={styles.block}>
          <Text style={styles.caption}>
            {stopCaption ? stopCaption(stop.order) : `${stop.order}`}
          </Text>
          <Text style={styles.addressMuted} numberOfLines={2}>
            {stop.address}
          </Text>
        </View>
      ))}
      <View style={styles.block}>
        <Text style={styles.caption}>{dropoffCaption}</Text>
        <Text style={styles.address} numberOfLines={3}>
          {dropoffAddress || "—"}
        </Text>
      </View>
      {metaLine || fallbackMeta ? (
        <Text style={styles.meta} numberOfLines={2}>
          {metaLine || fallbackMeta}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: MMD_GLASS,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: MMD_GOLD_CLASSIC_BORDER,
    padding: 16,
    gap: 12,
  },
  block: {
    gap: 4,
  },
  caption: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontWeight: "800",
    fontFamily: MMD_FONT.extrabold,
    letterSpacing: 0.4,
    textAlign: textAlignStart(),
    textTransform: "uppercase",
  },
  address: {
    color: MMD_WHITE,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
    lineHeight: 21,
    textAlign: textAlignStart(),
  },
  addressMuted: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 15,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    lineHeight: 20,
    textAlign: textAlignStart(),
  },
  meta: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    fontWeight: "600",
    fontFamily: MMD_FONT.semibold,
    textAlign: textAlignStart(),
  },
});
