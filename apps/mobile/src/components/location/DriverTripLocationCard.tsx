import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  ActivityIndicator,
  Image,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  fetchMmdLocationForTrip,
  type MmdLocationTripView,
} from "../../lib/mmdLocationApi";

type Props = {
  locationId?: string | null;
  title?: string;
  onViewOnMap?: (coords: { lat: number; lng: number }) => void;
};

export function DriverTripLocationCard({
  locationId,
  title,
  onViewOnMap,
}: Props) {
  const { t } = useTranslation();
  const heading = title ?? t("location.tripCard.defaultTitle");
  const [location, setLocation] = useState<MmdLocationTripView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = String(locationId ?? "").trim();
    if (!id) {
      setLocation(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetchMmdLocationForTrip(id)
      .then((row) => {
        if (cancelled) return;
        setLocation(row ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLocation(null);
        setError(
          toUserFacingError(
            e,
            t("location.tripCard.loadFailed"),
          ),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [locationId, t]);

  if (!locationId) return null;

  return (
    <View
      style={{
        marginTop: 10,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(56,189,248,0.35)",
        backgroundColor: "rgba(15,23,42,0.92)",
        padding: 12,
        gap: 10,
      }}
    >
      <Text style={{ color: "#7DD3FC", fontSize: 13, fontWeight: "800" }}>{heading}</Text>

      {loading ? (
        <ActivityIndicator color="#38BDF8" />
      ) : error ? (
        <Text style={{ color: "#FCA5A5", fontSize: 12 }}>{error}</Text>
      ) : location ? (
        <>
          {location.photo_url ? (
            <Image
              source={{ uri: location.photo_url }}
              style={{ width: "100%", height: 140, borderRadius: 12 }}
              resizeMode="cover"
            />
          ) : null}

          {location.landmark ? (
            <View>
              <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>
                {t("location.tripCard.landmark")}
              </Text>
              <Text style={{ color: "#E2E8F0", fontSize: 14, fontWeight: "700" }}>
                {location.landmark.name}
              </Text>
              <Text style={{ color: "#64748B", fontSize: 11, marginTop: 2 }}>
                {location.landmark.landmark_type}
                {location.landmark.commune_name ? ` · ${location.landmark.commune_name}` : ""}
              </Text>
            </View>
          ) : null}

          <View>
            <Text style={{ color: "#94A3B8", fontSize: 11, fontWeight: "700" }}>
              {t("location.tripCard.clientDirections")}
            </Text>
            <Text style={{ color: "#F8FAFC", fontSize: 13, lineHeight: 19 }}>
              {location.directions_text || location.address || "—"}
            </Text>
          </View>

          {location.formatted_address ? (
            <Text style={{ color: "#94A3B8", fontSize: 12 }}>{location.formatted_address}</Text>
          ) : null}

          <Text style={{ color: "#64748B", fontSize: 11 }}>
            {t("location.tripCard.pin")} {location.pin_lat.toFixed(5)}, {location.pin_lng.toFixed(5)}
          </Text>
        </>
      ) : (
        <Text style={{ color: "#94A3B8", fontSize: 12 }}>{t("location.tripCard.unavailable")}</Text>
      )}

      {onViewOnMap && location ? (
        <TouchableOpacity
          onPress={() =>
            onViewOnMap({
              lat: location.pin_lat,
              lng: location.pin_lng,
            })
          }
          style={{
            marginTop: 2,
            borderRadius: 999,
            paddingVertical: 12,
            alignItems: "center",
            backgroundColor: "#0EA5E9",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "800", fontSize: 13 }}>
            {t("location.tripCard.viewOnMap")}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
