import React, { useCallback, useState } from "react";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleOpen = useCallback(() => {
    if (!driverId) {
      Alert.alert(
        t("driver.report.sessionRequiredTitle", "Session required"),
        t(
          "driver.report.sessionRequiredBody",
          "Log in again to submit a report.",
        ),
      );
      return;
    }

    if (latitude == null || longitude == null) {
      Alert.alert(
        t("driver.report.gpsUnavailableTitle", "GPS unavailable"),
        t(
          "driver.report.gpsUnavailableBody",
          "Wait for a valid GPS position before reporting an issue.",
        ),
      );
      return;
    }

    setSheetVisible(true);
  }, [driverId, latitude, longitude, t]);

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
            ? t(
                "driver.report.rateLimited",
                "You reached the report limit for this hour.",
              )
            : result.reason === "invalid_country"
              ? t(
                  "driver.report.invalidCountry",
                  "Country not supported for reports.",
                )
              : t("driver.report.tryAgain", "Try again in a few moments."));

        Alert.alert(
          t("driver.report.failedTitle", "Report failed"),
          errorMessage,
        );
        return;
      }

      Alert.alert(
        t("driver.report.sentTitle", "Report sent"),
        t("driver.report.sentBody", "{{label}} reported. Visible for 25 minutes to nearby drivers.", {
          label: DRIVER_MAP_REPORT_LABELS[category],
        }),
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
      t,
    ],
  );

  return (
    <>
      <View
        style={{
          position: "absolute",
          left: 14,
          bottom: bottomOffset,
          zIndex: 30,
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
              {t("driver.report.nearbyAlerts", "{{count}} active alert nearby", {
                count: nearbyCount,
              })}
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
            {t("driver.report.reportButton", "Report")}
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
