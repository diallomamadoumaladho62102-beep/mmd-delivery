import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toUserFacingError } from "../../lib/userFacingError";
import { GPS_DEFAULTS } from "../../lib/verifiedClientGpsPure";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeLinearGradient as LinearGradient } from "../SafeLinearGradient";
import Mapbox from "@rnmapbox/maps";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import {
  ensureMapboxTokenApplied,
  isMapboxConfigured,
  MAP_STYLE_STREETS,
} from "../../lib/mapboxConfig";
import {
  saveMmdLocationWithOptionalPhoto,
  searchMmdLandmarks,
  searchMmdZones,
  type MmdLandmark,
  type MmdLocationPoint,
  type MmdZone,
} from "../../lib/mmdLocationApi";
import { defaultTaxiAddressConfig } from "../../lib/taxiAddressConfig";
import {
  getVerifiedClientGps,
  isGuineaMapCameraDefault,
  verifiedGpsUserMessage,
} from "../../lib/verifiedClientGps";
import {
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_DARK,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
} from "../../theme/mmdUi";
import { rowDirection, textAlignStart } from "../../i18n/rtl";

/** Map camera only — never a client pickup coordinate. */
const DEFAULT_GN_CENTER = {
  latitude: 9.6412,
  longitude: -13.5784,
};

const DEFAULT_CENTER_BY_COUNTRY: Record<string, { latitude: number; longitude: number }> = {
  GN: DEFAULT_GN_CENTER,
  US: { latitude: 40.7128, longitude: -74.006 },
  SN: { latitude: 14.7167, longitude: -17.4677 },
  CI: { latitude: 5.3600, longitude: -4.0083 },
  ML: { latitude: 12.6392, longitude: -8.0029 },
};

function defaultCenterForCountry(countryCode: string) {
  return DEFAULT_CENTER_BY_COUNTRY[countryCode] ?? DEFAULT_GN_CENTER;
}

export type MMDLocationPickerValue = {
  location: MmdLocationPoint;
};

type Props = {
  countryCode?: string;
  title?: string;
  submitLabel?: string;
  /**
   * Pickup/collecte: require a verified device GPS fix before save.
   * Map city centers are camera-only and cannot be saved as pickup.
   */
  requireVerifiedGps?: boolean;
  onSave: (value: MMDLocationPickerValue) => void | Promise<void>;
  onCancel?: () => void;
};

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      style={{
        color: MMD_GOLD_BRIGHT,
        fontSize: 14,
        marginBottom: 4,
        fontWeight: "600",
        fontFamily: MMD_FONT.semibold,
        textAlign: textAlignStart(),
      }}
    >
      {children}
    </Text>
  );
}

function FieldInput(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      {...props}
      placeholderTextColor="#9999A6"
      style={[
        {
          borderWidth: 1.5,
          borderColor: "rgba(255,255,255,0.5)",
          borderRadius: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          minHeight: 48,
          color: MMD_WHITE,
          backgroundColor: MMD_NAVY,
          fontFamily: MMD_FONT.regular,
          fontSize: 16,
          textAlign: textAlignStart(),
        },
        props.style,
      ]}
    />
  );
}

export default function MMDLocationPicker({
  countryCode,
  title,
  submitLabel,
  requireVerifiedGps = false,
  onSave,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("locationPicker.title", "Exact location");
  const resolvedSubmit =
    submitLabel ?? t("locationPicker.submitLabel", "Save location");
  const mapReady = ensureMapboxTokenApplied();

  if (!countryCode?.trim()) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: MMD_BLUE }}>
        <Text style={{ color: "#FCA5A5", textAlign: "center", fontFamily: MMD_FONT.semibold }}>
          {t(
            "locationPicker.marketRequired",
            "Market scope is required before choosing a location.",
          )}
        </Text>
      </View>
    );
  }

  const scopedCountryCode = countryCode.trim().toUpperCase();
  const addressConfig = useMemo(
    () => defaultTaxiAddressConfig(scopedCountryCode),
    [scopedCountryCode],
  );
  const structuredMode = addressConfig.structured_address_mode;
  const requireLandmark = addressConfig.landmark_prompt_required;
  const requirePinConfirm = addressConfig.manual_pin_confirmation_required;
  const cameraCenter = defaultCenterForCountry(scopedCountryCode);

  const [regionName, setRegionName] = useState("");
  const [prefectureName, setPrefectureName] = useState("");
  const [cityName, setCityName] = useState("");
  const [communeName, setCommuneName] = useState("");
  const [quartierName, setQuartierName] = useState("");
  const [streetNumber, setStreetNumber] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [formattedAddress, setFormattedAddress] = useState("");
  const [directionsText, setDirectionsText] = useState("");
  const [pinConfirmed, setPinConfirmed] = useState(!requirePinConfirm);
  const [landmarkQuery, setLandmarkQuery] = useState("");
  const [landmarks, setLandmarks] = useState<MmdLandmark[]>([]);
  const [zones, setZones] = useState<MmdZone[]>([]);
  const [selectedLandmark, setSelectedLandmark] = useState<MmdLandmark | null>(null);
  /** null until GPS or user places a pin — never pre-filled with city center. */
  const [pinLat, setPinLat] = useState<number | null>(null);
  const [pinLng, setPinLng] = useState<number | null>(null);
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [gpsVerified, setGpsVerified] = useState(false);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [locationSource, setLocationSource] = useState<"gps" | "pin" | "landmark">("pin");
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState<string | undefined>(undefined);
  const [loadingGps, setLoadingGps] = useState(false);
  const [loadingLandmarks, setLoadingLandmarks] = useState(false);
  const [saving, setSaving] = useState(false);

  const directionsValid =
    structuredMode || directionsText.trim().length >= 8;
  const structuredValid =
    !structuredMode ||
    (Boolean(cityName.trim()) &&
      (!addressConfig.street_number_required || Boolean(streetNumber.trim())) &&
      (!addressConfig.postal_code_required || Boolean(postalCode.trim())));
  const landmarkValid = !requireLandmark || Boolean(selectedLandmark) || directionsValid;
  const pinReady =
    pinLat != null &&
    pinLng != null &&
    Number.isFinite(pinLat) &&
    Number.isFinite(pinLng) &&
    !(
      scopedCountryCode === "GN" &&
      isGuineaMapCameraDefault(pinLat, pinLng) &&
      locationSource !== "gps"
    );
  const gpsGateOk = !requireVerifiedGps || gpsVerified;
  const canSave =
    pinReady &&
    gpsGateOk &&
    structuredValid &&
    landmarkValid &&
    (!requirePinConfirm || pinConfirmed) &&
    (structuredMode ? true : directionsValid);

  const mapCenter = useMemo(
    () =>
      [
        pinLng ?? cameraCenter.longitude,
        pinLat ?? cameraCenter.latitude,
      ] as [number, number],
    [pinLat, pinLng, cameraCenter.latitude, cameraCenter.longitude]
  );

  const loadZones = useCallback(async () => {
    try {
      const res = await searchMmdZones({
        country_code: scopedCountryCode,
        limit: 50,
      });
      setZones((res?.zones ?? []) as MmdZone[]);
    } catch {
      setZones([]);
    }
  }, [countryCode]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  useEffect(() => {
    if (!landmarkQuery.trim() && !communeName.trim()) {
      setLandmarks([]);
      return;
    }

    const timer = setTimeout(() => {
      setLoadingLandmarks(true);
      void searchMmdLandmarks({
        country_code: scopedCountryCode,
        q: landmarkQuery.trim() || undefined,
        commune_name: communeName.trim() || undefined,
        quartier_name: quartierName.trim() || undefined,
        limit: 12,
      })
        .then((res) => setLandmarks((res?.landmarks ?? []) as MmdLandmark[]))
        .catch(() => setLandmarks([]))
        .finally(() => setLoadingLandmarks(false));
    }, 350);

    return () => clearTimeout(timer);
  }, [landmarkQuery, communeName, quartierName, scopedCountryCode]);

  async function handleUseGps() {
    setLoadingGps(true);
    setGpsError(null);
    try {
      const result = await getVerifiedClientGps({
        maxAccuracyM: addressConfig.minimum_location_accuracy_meters,
      });
      if (result.ok === false) {
        setGpsVerified(false);
        const msg = verifiedGpsUserMessage(result);
        const text = t(msg.key, msg.defaultValue);
        setGpsError(text);
        Alert.alert(t("locationPicker.gpsErrorTitle", "GPS error"), text);
        return;
      }
      setGpsLat(result.latitude);
      setGpsLng(result.longitude);
      setPinLat(result.latitude);
      setPinLng(result.longitude);
      setAccuracyM(result.accuracyM);
      setLocationSource("gps");
      setGpsVerified(true);
      if (requirePinConfirm) setPinConfirmed(true);
    } catch (e: unknown) {
      setGpsVerified(false);
      const text = toUserFacingError(
        e,
        t(
          "gps.unavailable",
          GPS_DEFAULTS.unavailable
        )
      );
      setGpsError(text);
      Alert.alert(t("locationPicker.gpsErrorTitle", "GPS error"), text);
    } finally {
      setLoadingGps(false);
    }
  }

  useEffect(() => {
    if (!requireVerifiedGps) return;
    void handleUseGps();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on open for pickup
  }, [requireVerifiedGps]);

  function handleSelectZone(zone: MmdZone) {
    setRegionName(zone.region_name ?? regionName);
    setPrefectureName(zone.prefecture_name ?? prefectureName);
    setCityName(zone.city_name ?? cityName);
    setCommuneName(zone.commune_name ?? "");
    setQuartierName(zone.quartier_name ?? "");
  }

  function handleSelectLandmark(landmark: MmdLandmark) {
    if (requireVerifiedGps && !gpsVerified) {
      Alert.alert(
        t("locationPicker.gpsErrorTitle", "GPS error"),
        t(
          "gps.unavailable",
          GPS_DEFAULTS.unavailable
        )
      );
      return;
    }
    setSelectedLandmark(landmark);
    setLandmarkQuery(landmark.name);
    setRegionName(landmark.region_name ?? regionName);
    setPrefectureName(landmark.prefecture_name ?? prefectureName);
    setCityName(landmark.city_name ?? cityName);
    setCommuneName(landmark.commune_name ?? communeName);
    setQuartierName(landmark.quartier_name ?? quartierName);
    setPinLat(landmark.lat);
    setPinLng(landmark.lng);
    setLocationSource("landmark");
  }

  function handleMapPress(event: { geometry?: { coordinates?: number[] } }) {
    const coords = event?.geometry?.coordinates;
    if (!coords || coords.length < 2) return;
    if (requireVerifiedGps && !gpsVerified) {
      Alert.alert(
        t("locationPicker.gpsErrorTitle", "GPS error"),
        t(
          "gps.mustVerifyBeforePin",
          GPS_DEFAULTS.mustVerifyBeforePin
        )
      );
      return;
    }
    setPinLng(coords[0]);
    setPinLat(coords[1]);
    // Manual adjustment after a GPS fix is recorded as pin, not device GPS.
    setLocationSource("pin");
    if (requirePinConfirm) setPinConfirmed(false);
  }

  async function handlePickPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        t("locationPicker.permissionTitle", "Permission required"),
        t("locationPicker.cameraPermissionBody", "Allow camera access to add a location photo."),
      );
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    setPhotoUri(asset.uri);
    setPhotoMime(
      (asset as { mimeType?: string }).mimeType ??
        (asset.uri.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg")
    );
  }

  async function handleSave() {
    if (requireVerifiedGps && !gpsVerified) {
      Alert.alert(
        t("locationPicker.gpsErrorTitle", "GPS error"),
        gpsError ??
          t(
            "gps.unavailable",
            GPS_DEFAULTS.unavailable
          )
      );
      return;
    }
    if (!pinReady || pinLat == null || pinLng == null) {
      Alert.alert(
        t("locationPicker.missingInfoTitle", "Missing information"),
        t(
          "locationPicker.missingPinBody",
          "Obtain your GPS position (or place the pin) before saving."
        )
      );
      return;
    }
    if (!canSave) {
      Alert.alert(
        t("locationPicker.missingInfoTitle", "Missing information"),
        structuredMode
          ? t(
              "locationPicker.missingStructuredBody",
              "Enter street number, city, and postal code, then place the pin.",
            )
          : requirePinConfirm
            ? t(
                "locationPicker.missingPinConfirmBody",
                "Confirm the map pin and add landmark or directions so the driver can find you.",
              )
            : t(
                "locationPicker.missingDirectionsBody",
                "Move the pin on the map and describe your exact location (minimum 8 characters).",
              ),
      );
      return;
    }

    setSaving(true);
    try {
      let photoPayload: { uri: string; mime?: string; base64?: string } | null = null;
      if (photoUri) {
        const base64 = await FileSystem.readAsStringAsync(photoUri, {
          encoding: "base64",
        });
        photoPayload = { uri: photoUri, mime: photoMime, base64 };
      }

      const structuredFormatted = [
        streetNumber.trim(),
        cityName.trim(),
        postalCode.trim(),
      ]
        .filter(Boolean)
        .join(", ");

      // US structured mode hides the free-text directions field, but the locations
      // API still requires directions_text (>= 8 chars). Derive a stable fallback
      // from the structured address + pin so pickup save is not blocked.
      const directionsForApi = (() => {
        const typed = directionsText.trim();
        if (typed.length >= 8) return typed;
        if (!structuredMode) return typed;
        const fallback = [
          structuredFormatted,
          formattedAddress.trim(),
          pinLat != null && pinLng != null
            ? `Pin ${pinLat.toFixed(5)}, ${pinLng.toFixed(5)}`
            : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return fallback.length >= 8 ? fallback : "Map pin confirmed";
      })();

      const location = await saveMmdLocationWithOptionalPhoto({
        input: {
          country_code: scopedCountryCode,
          region_name: regionName.trim() || undefined,
          prefecture_name: prefectureName.trim() || undefined,
          city_name: cityName.trim() || undefined,
          commune_name: communeName.trim() || undefined,
          quartier_name: quartierName.trim() || undefined,
          formatted_address:
            formattedAddress.trim() ||
            (structuredMode ? structuredFormatted : undefined) ||
            undefined,
          directions_text: directionsForApi,
          geocoded_lat: gpsLat,
          geocoded_lng: gpsLng,
          pin_lat: pinLat,
          pin_lng: pinLng,
          accuracy_m: accuracyM,
          location_source: locationSource,
          primary_landmark_id: selectedLandmark?.id ?? null,
        },
        photo: photoPayload,
      });

      await onSave({ location });
    } catch (e: unknown) {
      Alert.alert(
        t("locationPicker.saveFailedTitle", "Save failed"),
        toUserFacingError(e, t("locationPicker.saveFailedBody", "Unable to save location")),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: MMD_BLUE }}
      contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
    >
      <View
        style={{
          flexDirection: rowDirection(),
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: MMD_WHITE,
            fontSize: 24,
            fontWeight: "700",
            fontFamily: MMD_FONT.bold,
            textAlign: textAlignStart(),
          }}
        >
          {resolvedTitle}
        </Text>
        {onCancel ? (
          <TouchableOpacity onPress={onCancel}>
            <Text
              style={{
                color: MMD_GOLD_BRIGHT,
                fontSize: 16,
                fontFamily: MMD_FONT.regular,
              }}
            >
              {t("locationPicker.cancel", "Cancel")}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text
        style={{
          color: MMD_MUTED,
          fontSize: 14,
          fontFamily: MMD_FONT.regular,
          textAlign: textAlignStart(),
        }}
      >
        {structuredMode
          ? t(
              "locationPicker.hintStructured",
              "Enter your street number, city, and ZIP, then place the pin on the exact entrance.",
            )
          : requirePinConfirm
            ? t(
                scopedCountryCode === "GN"
                  ? "locationPicker.hintPinConfirmLocal"
                  : "locationPicker.hintPinConfirm",
                "Tap the map to place your pin, confirm it, and add a landmark or directions so the driver can find you.",
              )
            : t(
                "locationPicker.hintPin",
                "Tap the map to place your exact pin. Describe the place so the driver can find you even without a street number.",
              )}
      </Text>

      <View
        style={{
          height: 240,
          borderRadius: 12,
          overflow: "hidden",
          borderWidth: 1,
          borderColor: "rgba(255,215,0,0.3)",
        }}
      >
        {!mapReady || !isMapboxConfigured() ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16 }}>
            <Text style={{ color: MMD_MUTED, textAlign: "center", fontFamily: MMD_FONT.regular }}>
              {t(
                "locationPicker.mapUnavailable",
                "Map unavailable. Configure EXPO_PUBLIC_MAPBOX_TOKEN to use the location picker.",
              )}
            </Text>
          </View>
        ) : (
          <Mapbox.MapView
            style={{ flex: 1 }}
            styleURL={MAP_STYLE_STREETS}
            onPress={handleMapPress}
          >
            <Mapbox.Camera
              zoomLevel={14}
              centerCoordinate={mapCenter}
              animationMode="flyTo"
              animationDuration={300}
            />
            {pinLat != null && pinLng != null ? (
              <Mapbox.PointAnnotation
                id="mmd-location-pin"
                coordinate={[pinLng, pinLat]}
              >
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: MMD_GOLD_BRIGHT,
                    borderWidth: 2,
                    borderColor: MMD_WHITE,
                  }}
                />
              </Mapbox.PointAnnotation>
            ) : null}
          </Mapbox.MapView>
        )}
      </View>

      {gpsError ? (
        <Text
          style={{
            color: "#FCA5A5",
            fontSize: 14,
            fontFamily: MMD_FONT.semibold,
            textAlign: textAlignStart(),
          }}
        >
          {gpsError}
        </Text>
      ) : null}

      <TouchableOpacity
        onPress={() => void handleUseGps()}
        disabled={loadingGps}
        style={{
          backgroundColor: MMD_WHITE,
          borderRadius: 10,
          paddingVertical: 12,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: "#E2E8F0",
        }}
      >
        {loadingGps ? (
          <ActivityIndicator color={MMD_NAVY} />
        ) : (
          <Text
            style={{
              color: "#0F172A",
              fontWeight: "600",
              fontFamily: MMD_FONT.semibold,
              fontSize: 15,
            }}
          >
            {gpsVerified
              ? t("locationPicker.retryGps", "Refresh my GPS position")
              : scopedCountryCode === "GN"
                ? t("locationPicker.useGpsCurrent", "My current location")
                : t("locationPicker.useGps", "Use my current GPS")}
          </Text>
        )}
      </TouchableOpacity>

      {pinLat != null && pinLng != null ? (
        accuracyM != null ? (
          <Text style={{ color: MMD_MUTED, fontSize: 13, fontFamily: MMD_FONT.regular }}>
            {t("locationPicker.gpsAccuracy", {
              defaultValue: "GPS accuracy: ~{{meters}} m · Pin: {{lat}}, {{lng}}",
              meters: Math.round(accuracyM),
              lat: pinLat.toFixed(5),
              lng: pinLng.toFixed(5),
            })}
          </Text>
        ) : (
          <Text style={{ color: MMD_MUTED, fontSize: 13, fontFamily: MMD_FONT.regular }}>
            {t("locationPicker.pinSource", {
              defaultValue: "Pin: {{lat}}, {{lng}} · source: {{source}}",
              lat: pinLat.toFixed(5),
              lng: pinLng.toFixed(5),
              source: locationSource,
            })}
          </Text>
        )
      ) : (
        <Text style={{ color: MMD_MUTED, fontSize: 13, fontFamily: MMD_FONT.regular }}>
          {t(
            "locationPicker.awaitingGps",
            "No client position yet. The map center is only a preview — not your pickup."
          )}
        </Text>
      )}

      {requirePinConfirm ? (
        <TouchableOpacity
          onPress={() => setPinConfirmed(true)}
          style={{
            backgroundColor: pinConfirmed ? "rgba(34,197,94,0.15)" : MMD_NAVY,
            borderRadius: 12,
            paddingVertical: 12,
            alignItems: "center",
            borderWidth: 1,
            borderColor: pinConfirmed ? "#22C55E" : MMD_GOLD_BRIGHT,
          }}
        >
          <Text
            style={{
              color: pinConfirmed ? "#86EFAC" : MMD_GOLD_BRIGHT,
              fontWeight: "700",
              fontFamily: MMD_FONT.bold,
            }}
          >
            {pinConfirmed
              ? t("locationPicker.pinConfirmed", "Pin confirmed")
              : t("locationPicker.confirmPin", "Confirm pin location")}
          </Text>
        </TouchableOpacity>
      ) : null}

      {!structuredMode ? (
        <View style={{ flexDirection: rowDirection(), gap: 10 }}>
          <View style={{ flex: 1 }}>
            <FieldLabel>{t("locationPicker.region", "Region")}</FieldLabel>
            <FieldInput
              value={regionName}
              onChangeText={setRegionName}
              placeholder={t("locationPicker.regionPlaceholder", "Region")}
            />
          </View>
          <View style={{ flex: 1 }}>
            <FieldLabel>{t("locationPicker.prefecture", "Prefecture")}</FieldLabel>
            <FieldInput
              value={prefectureName}
              onChangeText={setPrefectureName}
              placeholder={t("locationPicker.prefecturePlaceholder", "Prefecture")}
            />
          </View>
        </View>
      ) : null}

      {zones.length > 0 && !structuredMode ? (
        <View style={{ gap: 8 }}>
          <FieldLabel>
            {t("locationPicker.zoneLabel", {
              defaultValue: "Zone ({{code}})",
              code: scopedCountryCode,
            })}
          </FieldLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: rowDirection(), gap: 8 }}>
              {zones.slice(0, 16).map((zone) => (
                <TouchableOpacity
                  key={zone.id}
                  onPress={() => handleSelectZone(zone)}
                  style={{
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: "rgba(255,215,0,0.4)",
                    backgroundColor: MMD_NAVY,
                  }}
                >
                  <Text
                    style={{
                      color: MMD_WHITE,
                      fontSize: 14,
                      fontWeight: "600",
                      fontFamily: MMD_FONT.semibold,
                    }}
                  >
                    {zone.zone_name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : null}

      {structuredMode ? (
        <View style={{ gap: 10 }}>
          <View>
            <FieldLabel>
              {t("locationPicker.streetNumber", "Street number *")}
            </FieldLabel>
            <FieldInput
              value={streetNumber}
              onChangeText={setStreetNumber}
              placeholder={t("locationPicker.streetNumberPlaceholder", "123")}
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View>
            <FieldLabel>{t("locationPicker.city", "City *")}</FieldLabel>
            <FieldInput
              value={cityName}
              onChangeText={setCityName}
              placeholder={t("locationPicker.cityPlaceholder", "New York")}
            />
          </View>
          <View>
            <FieldLabel>
              {t("locationPicker.zip", "ZIP / Postal code *")}
            </FieldLabel>
            <FieldInput
              value={postalCode}
              onChangeText={setPostalCode}
              placeholder={t("locationPicker.zipPlaceholder", "10001")}
              autoCapitalize="characters"
            />
          </View>
          <View>
            <FieldLabel>
              {t(
                "locationPicker.streetOptional",
                "Street / place name (optional)",
              )}
            </FieldLabel>
            <FieldInput
              value={formattedAddress}
              onChangeText={setFormattedAddress}
              placeholder={t(
                "locationPicker.streetOptionalPlaceholder",
                "Main St / building name",
              )}
            />
          </View>
        </View>
      ) : (
        <>
      <View style={{ flexDirection: rowDirection(), gap: 10 }}>
        <View style={{ flex: 1 }}>
          <FieldLabel>{t("locationPicker.communeTown", "Town / commune")}</FieldLabel>
          <FieldInput
            value={communeName}
            onChangeText={setCommuneName}
            placeholder={t("locationPicker.communeTownPlaceholder", "Town or commune")}
          />
        </View>
        <View style={{ flex: 1 }}>
          <FieldLabel>{t("locationPicker.quartierSector", "Neighborhood / sector")}</FieldLabel>
          <FieldInput
            value={quartierName}
            onChangeText={setQuartierName}
            placeholder={t(
              "locationPicker.quartierSectorPlaceholder",
              "Neighborhood or sector",
            )}
          />
        </View>
      </View>

      <View>
        <FieldLabel>
          {requireLandmark
            ? t("locationPicker.landmarkSearchRequired", "Landmark search *")
            : t("locationPicker.landmarkSearch", "Landmark search")}
        </FieldLabel>
        <FieldInput
          value={landmarkQuery}
          onChangeText={(text) => {
            setLandmarkQuery(text);
            setSelectedLandmark(null);
          }}
          placeholder={t(
            scopedCountryCode === "GN"
              ? "locationPicker.landmarkPlaceholderLocal"
              : "locationPicker.landmarkPlaceholder",
            "Station Total, mosque, market...",
          )}
        />
        {loadingLandmarks ? (
          <ActivityIndicator color={MMD_GOLD_BRIGHT} style={{ marginTop: 8 }} />
        ) : null}
        {landmarks.length > 0 ? (
          <View style={{ marginTop: 8, gap: 6 }}>
            {landmarks.map((landmark) => (
              <TouchableOpacity
                key={landmark.id}
                onPress={() => handleSelectLandmark(landmark)}
                style={{
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor:
                    selectedLandmark?.id === landmark.id
                      ? MMD_GOLD_BRIGHT
                      : MMD_CARD_BORDER,
                  backgroundColor: MMD_NAVY,
                }}
              >
                <Text
                  style={{
                    color: MMD_WHITE,
                    fontWeight: "600",
                    fontFamily: MMD_FONT.semibold,
                  }}
                >
                  {landmark.name}
                </Text>
                <Text style={{ color: MMD_MUTED, fontSize: 11, marginTop: 2 }}>
                  {landmark.landmark_type}
                  {landmark.commune_name ? ` · ${landmark.commune_name}` : ""}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>

      <View>
        <FieldLabel>
          {t("locationPicker.formattedAddress", "Formatted address (optional)")}
        </FieldLabel>
        <FieldInput
          value={formattedAddress}
          onChangeText={setFormattedAddress}
          placeholder={t(
            "locationPicker.formattedAddressPlaceholder",
            "Street or place name if known",
          )}
        />
      </View>

      <View>
        <FieldLabel>
          {t(
            "locationPicker.directions",
            "Describe your exact location *",
          )}
        </FieldLabel>
        <FieldInput
          value={directionsText}
          onChangeText={setDirectionsText}
          placeholder={t(
            "locationPicker.directionsPlaceholder",
            "After Total station, second road on the right, yellow house with blue gate...",
          )}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
          style={{ minHeight: 96 }}
        />
        {!directionsValid ? (
          <Text
            style={{
              color: "#F87171",
              fontSize: 12,
              marginTop: 4,
              fontFamily: MMD_FONT.regular,
            }}
          >
            {t(
              "locationPicker.directionsMin",
              "Minimum 8 characters required.",
            )}
          </Text>
        ) : null}
      </View>
        </>
      )}

      <View style={{ gap: 8 }}>
        <FieldLabel>
          {t("locationPicker.photoLabel", "Photo of the place (recommended)")}
        </FieldLabel>
        <TouchableOpacity
          onPress={() => void handlePickPhoto()}
          style={{
            borderRadius: 10,
            borderWidth: 1,
            borderColor: MMD_CARD_BORDER,
            padding: 12,
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: MMD_NAVY,
          }}
        >
          <Text
            style={{
              color: MMD_WHITE,
              fontWeight: "600",
              fontFamily: MMD_FONT.semibold,
              fontSize: 15,
            }}
          >
            {photoUri
              ? t("locationPicker.retakePhoto", "Retake location photo")
              : t(
                  "locationPicker.addPhoto",
                  "Add photo of gate, shop, or building",
                )}
          </Text>
        </TouchableOpacity>
        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={{ width: "100%", height: 160, borderRadius: 12 }}
            resizeMode="cover"
          />
        ) : null}
      </View>

      <TouchableOpacity
        onPress={() => void handleSave()}
        disabled={!canSave || saving}
        activeOpacity={0.85}
        style={{ marginTop: 8, opacity: canSave ? 1 : 0.55 }}
      >
        <LinearGradient
          colors={canSave ? [MMD_GOLD_DARK, MMD_GOLD_BRIGHT] : ["#64748B", "#94A3B8"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            borderRadius: 10,
            paddingVertical: 14,
            minHeight: 44,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {saving ? (
            <ActivityIndicator color={MMD_NAVY} />
          ) : (
            <Text
              style={{
                color: MMD_NAVY,
                fontWeight: "700",
                fontFamily: MMD_FONT.semibold,
                fontSize: 16,
              }}
            >
              {resolvedSubmit}
            </Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}
