import React from "react";
import { Text, View } from "react-native";
import Mapbox from "@rnmapbox/maps";
import type { CoordinatePoint } from "../../lib/coordinates";

type Props = {
  stage: "pickup" | "dropoff";
  destination: CoordinatePoint | null;
  /** Authorized meeting point (pickup coords only — never invented live GPS). */
  clientMeeting: CoordinatePoint | null;
};

function Pin({
  color,
  label,
  emoji,
}: {
  color: string;
  label: string;
  emoji: string;
}) {
  return (
    <View style={{ alignItems: "center" }}>
      <View
        style={{
          backgroundColor: color,
          borderRadius: 14,
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderWidth: 2,
          borderColor: "#FFFFFF",
          shadowColor: "#000",
          shadowOpacity: 0.3,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
          minWidth: 44,
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 14 }}>{emoji}</Text>
        <Text
          style={{
            color: "#FFFFFF",
            fontSize: 10,
            fontWeight: "900",
            marginTop: 2,
          }}
        >
          {label}
        </Text>
      </View>
      <View
        style={{
          width: 0,
          height: 0,
          borderLeftWidth: 6,
          borderRightWidth: 6,
          borderTopWidth: 8,
          borderLeftColor: "transparent",
          borderRightColor: "transparent",
          borderTopColor: color,
          marginTop: -1,
        }}
      />
    </View>
  );
}

/**
 * Distinct map pins for destination (pickup/dropoff) and client meeting point.
 * Client meeting uses the ride's authorized pickup coordinates only.
 * When meeting == pickup, one combined pin avoids overlapping markers.
 */
export function DriverTripEndpointMarkers({
  stage,
  destination,
  clientMeeting,
}: Props) {
  const destColor = stage === "pickup" ? "#16A34A" : "#DC2626";
  const destLabel = stage === "pickup" ? "PICKUP" : "DROP-OFF";
  const destEmoji = stage === "pickup" ? "📍" : "🏁";

  const samePoint =
    clientMeeting &&
    destination &&
    Math.abs(clientMeeting.latitude - destination.latitude) <= 0.00005 &&
    Math.abs(clientMeeting.longitude - destination.longitude) <= 0.00005;

  if (samePoint && destination) {
    return (
      <Mapbox.MarkerView
        id="trip-client-pickup"
        coordinate={[destination.longitude, destination.latitude]}
        anchor={{ x: 0.5, y: 1 }}
        allowOverlap
      >
        <Pin color="#2563EB" label="CLIENT · PICKUP" emoji="👤" />
      </Mapbox.MarkerView>
    );
  }

  return (
    <>
      {destination ? (
        <Mapbox.MarkerView
          id={`trip-dest-${stage}`}
          coordinate={[destination.longitude, destination.latitude]}
          anchor={{ x: 0.5, y: 1 }}
          allowOverlap
        >
          <Pin color={destColor} label={destLabel} emoji={destEmoji} />
        </Mapbox.MarkerView>
      ) : null}

      {clientMeeting ? (
        <Mapbox.MarkerView
          id="trip-client-meeting"
          coordinate={[clientMeeting.longitude, clientMeeting.latitude]}
          anchor={{ x: 0.5, y: 1 }}
          allowOverlap
        >
          <Pin color="#2563EB" label="CLIENT" emoji="👤" />
        </Mapbox.MarkerView>
      ) : null}
    </>
  );
}
