import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import {
  DEFAULT_DRIVER_MAP_REPORT_CONTEXT,
  DRIVER_MAP_REPORT_LABELS,
  type DriverMapCountryCode,
  type DriverMapModuleType,
  type DriverMapReportCategory,
  type DriverMapReportSourceTable,
} from "../../lib/driverNavigation/reports/config";
import { submitDriverMapReport } from "../../lib/driverNavigation/reports/service";
import { DriverReportSheet } from "./DriverReportSheet";

type Props = {
  driverId: string | null;
  latitude: number | null;
  longitude: number | null;
  orderId?: string | null;
  sourceTable?: DriverMapReportSourceTable | null;
  moduleType?: DriverMapModuleType;
  countryCode?: DriverMapCountryCode;
  nearbyCount?: number;
  bottomOffset?: number;
  onSubmitted?: () => void;
};

export function DriverReportButton({
  driverId,
  latitude,
  longitude,
  orderId = null,
  sourceTable = null,
  moduleType = DEFAULT_DRIVER_MAP_REPORT_CONTEXT.moduleType,
  countryCode = DEFAULT_DRIVER_MAP_REPORT_CONTEXT.countryCode,
  nearbyCount = 0,
  bottomOffset = 28,
  onSubmitted,
}: Props) {
  const [sheetVisible, setSheetVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleOpen = useCallback(() => {
    if (!driverId) {
      Alert.alert("Session requise", "Reconnecte-toi pour envoyer un signalement.");
      return;
    }

    if (latitude == null || longitude == null) {
      Alert.alert(
        "GPS indisponible",
        "Attends une position GPS valide avant de signaler un problème.",
      );
      return;
    }

    setSheetVisible(true);
  }, [driverId, latitude, longitude]);

  const handleSelectCategory = useCallback(
    async (category: DriverMapReportCategory) => {
      if (!driverId || latitude == null || longitude == null) return;

      setSubmitting(true);

      const result = await submitDriverMapReport(driverId, {
        category,
        latitude,
        longitude,
        orderId,
        sourceTable,
        moduleType,
        countryCode,
      });

      setSubmitting(false);
      setSheetVisible(false);

      if (result.ok === false) {
        const errorMessage =
          result.message ??
          (result.reason === "rate_limited"
            ? "Tu as atteint la limite de signalements pour cette heure."
            : result.reason === "invalid_country"
              ? "Pays non pris en charge pour les signalements."
              : "Réessaie dans quelques instants.");

        Alert.alert("Signalement impossible", errorMessage);
        return;
      }

      Alert.alert(
        "Signalement envoyé",
        `${DRIVER_MAP_REPORT_LABELS[category]} signalé. Visible 25 minutes pour les chauffeurs à proximité.`,
      );
      onSubmitted?.();
    },
    [
      countryCode,
      driverId,
      latitude,
      longitude,
      moduleType,
      onSubmitted,
      orderId,
      sourceTable,
    ],
  );

  return (
    <>
      <View
        style={{
          position: "absolute",
          left: 14,
          bottom: bottomOffset,
          alignItems: "flex-start",
        }}
      >
        {nearbyCount > 0 && (
          <View
            pointerEvents="none"
            style={{
              marginBottom: 8,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: "rgba(69,26,3,0.92)",
              borderWidth: 1,
              borderColor: "rgba(251,146,60,0.35)",
            }}
          >
            <Text style={{ color: "#FDBA74", fontSize: 11, fontWeight: "800" }}>
              {nearbyCount} alerte{nearbyCount > 1 ? "s" : ""} active
              {nearbyCount > 1 ? "s" : ""} à proximité
            </Text>
          </View>
        )}

        <TouchableOpacity
          activeOpacity={0.86}
          onPress={handleOpen}
          style={{
            paddingHorizontal: 14,
            paddingVertical: 10,
            borderRadius: 999,
            backgroundColor: "rgba(127,29,29,0.92)",
            borderWidth: 1,
            borderColor: "rgba(251,113,133,0.34)",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>
            Signaler
          </Text>
        </TouchableOpacity>
      </View>

      <DriverReportSheet
        visible={sheetVisible}
        submitting={submitting}
        onClose={() => {
          if (!submitting) setSheetVisible(false);
        }}
        onSelectCategory={(category) => void handleSelectCategory(category)}
      />
    </>
  );
}

export { DriverReportButton as DriverReportButtonActive };
