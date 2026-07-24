import React, { useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { textAlignStart } from "../../i18n/rtl";
import {
  driverInitials,
  type CustomerTrackingIdentification,
} from "../../lib/customerTrackingIdentification";

type Props = {
  identification: CustomerTrackingIdentification;
  vehicleType?: string | null;
  newDriverLabel: string;
  tripsLabel: (count: number) => string;
  yearLabel: (year: number) => string;
  plateCaption: string;
  vehicleFallback: string;
  photoUnavailableLabel: string;
  photoAccessibilityLabel: string;
  vehiclePhotoAccessibilityLabel: string;
  vehicleA11ySummary: string;
};

function vehicleTypeIcon(
  vehicleType: string | null | undefined,
): keyof typeof Ionicons.glyphMap {
  const t = String(vehicleType ?? "").toLowerCase();
  if (t.includes("moto") || t.includes("scooter") || t.includes("bike")) {
    return "bicycle-outline";
  }
  if (t.includes("van") || t.includes("truck")) return "bus-outline";
  return "car-sport-outline";
}

/**
 * Premium driver + vehicle card.
 * Vehicle photo uses the real assigned-ride snapshot URL only.
 * Missing/invalid photo → neutral type icon (never a branded stock car).
 */
export const DriverProfileCard = React.memo(function DriverProfileCard({
  identification,
  vehicleType = null,
  newDriverLabel,
  tripsLabel,
  yearLabel,
  plateCaption,
  vehicleFallback,
  photoUnavailableLabel,
  photoAccessibilityLabel,
  vehiclePhotoAccessibilityLabel,
  vehicleA11ySummary,
}: Props) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const [vehicleFailed, setVehicleFailed] = useState(false);
  const showPhoto = Boolean(identification.driverPhoto) && !photoFailed;
  const showVehiclePhoto =
    Boolean(identification.vehiclePhoto) && !vehicleFailed;
  const rating = identification.driverRating;
  const trips = identification.driverTrips;
  const fallbackIcon = useMemo(
    () => vehicleTypeIcon(vehicleType),
    [vehicleType],
  );

  return (
    <View
      style={styles.card}
      accessible
      accessibilityLabel={vehicleA11ySummary}
    >
      <View style={styles.header}>
        <View
          style={styles.avatarWrap}
          accessibilityLabel={photoAccessibilityLabel}
        >
          {showPhoto ? (
            <Image
              source={{ uri: identification.driverPhoto }}
              style={styles.avatar}
              resizeMode="cover"
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.initials}>
                {driverInitials(identification.driverName)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={2}>
            {identification.driverName || "—"}
          </Text>
          {rating != null ? (
            <Text style={styles.rating} numberOfLines={1}>
              ★ {rating.toFixed(1)}
              {trips != null ? `  ·  ${tripsLabel(trips)}` : ""}
            </Text>
          ) : (
            <Text style={styles.ratingMuted}>{newDriverLabel}</Text>
          )}
        </View>
      </View>

      <View
        style={styles.vehiclePhotoWrap}
        accessibilityLabel={vehiclePhotoAccessibilityLabel}
      >
        {showVehiclePhoto ? (
          <Image
            source={{ uri: identification.vehiclePhoto }}
            style={styles.vehiclePhoto}
            resizeMode="cover"
            onError={() => setVehicleFailed(true)}
          />
        ) : (
          <View style={styles.vehicleFallback}>
            <Ionicons name={fallbackIcon} size={44} color="#94A3B8" />
            <Text style={styles.vehicleFallbackText}>
              {photoUnavailableLabel}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.vehicleTextCol}>
        <Text style={styles.vehicleLabel} numberOfLines={2}>
          {identification.vehicleLabel || vehicleFallback}
        </Text>
        {identification.vehicleYear ? (
          <Text style={styles.vehicleYear}>
            {yearLabel(identification.vehicleYear)}
          </Text>
        ) : null}
        {identification.vehiclePlate ? (
          <View style={styles.plate}>
            <Text style={styles.plateCaption}>{plateCaption}</Text>
            <Text style={styles.plateValue} numberOfLines={1}>
              {identification.vehiclePlate}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#0F172A",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
    padding: 16,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatarWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: "rgba(248,250,252,0.4)",
    overflow: "hidden",
    backgroundColor: "#1E293B",
  },
  avatar: {
    width: "100%",
    height: "100%",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "800",
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    color: "#F8FAFC",
    fontSize: 19,
    fontWeight: "800",
    textAlign: textAlignStart(),
  },
  rating: {
    color: "#FDE68A",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 4,
    textAlign: textAlignStart(),
  },
  ratingMuted: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
    textAlign: textAlignStart(),
  },
  vehiclePhotoWrap: {
    width: "100%",
    height: 156,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#1E293B",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.18)",
  },
  vehiclePhoto: {
    width: "100%",
    height: "100%",
  },
  vehicleFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  vehicleFallbackText: {
    color: "#64748B",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },
  vehicleTextCol: {
    gap: 6,
  },
  vehicleLabel: {
    color: "#FBBF24",
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
    textAlign: textAlignStart(),
  },
  vehicleYear: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
    textAlign: textAlignStart(),
  },
  plate: {
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#0F172A",
    paddingVertical: 8,
    paddingHorizontal: 14,
    minWidth: 140,
  },
  plateCaption: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textAlign: "center",
  },
  plateValue: {
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 1.6,
    textAlign: "center",
  },
});
