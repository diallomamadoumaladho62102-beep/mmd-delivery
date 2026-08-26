import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toUserFacingError } from "../../lib/userFacingError";
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
import * as Location from "expo-location";
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
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_FONT,
  MMD_GOLD_BRIGHT,
  MMD_GOLD_DARK,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
} from "../../theme/mmdUi";

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
        },
        props.style,
      ]}
    />
  );
}

export default function MMDLocationPicker({
  countryCode,
  title = "Exact location",
  submitLabel = "Save location",
  onSave,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const mapReady = ensureMapboxTokenApplied();

  if (!countryCode?.trim()) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 20, backgroundColor: MMD_BLUE }}>
        <Text style={{ color: "#FCA5A5", textAlign: "center", fontFamily: MMD_FONT.semibold }}>
          Market scope is required before choosing a location.
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
  const initialCenter = defaultCenterForCountry(scopedCountryCode);

  const [regionName, setRegionName] = useState("Conakry");
  const [prefectureName, setPrefectureName] = useState("Conakry");
  const [cityName, setCityName] = useState(structuredMode ? "" : "Conakry");
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
  const [pinLat, setPinLat] = useState(initialCenter.latitude);
  const [pinLng, setPinLng] = useState(initialCenter.longitude);
  const [gpsLat, setGpsLat] = useState<number | null>(null);
  const [gpsLng, setGpsLng] = useState<number | null>(null);
  const [accuracyM, setAccuracyM] = useState<number | null>(null);
  const [locationSource, setLocationSource] = useState<"gps" | "pin" | "landmark">("pin");
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
  const canSave =
    Number.isFinite(pinLat) &&
    Number.isFinite(pinLng) &&
    structuredValid &&
    landmarkValid &&
    (!requirePinConfirm || pinConfirmed) &&
    (structuredMode ? true : directionsValid);

  const mapCenter = useMemo(
    () => [pinLng, pinLat] as [number, number],
    [pinLat, pinLng]
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
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          t("locationPicker.permissionTitle", "Permission required"),
          t("locationPicker.gpsPermissionBody", "Allow location access to use GPS."),
        );
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setGpsLat(lat);
      setGpsLng(lng);
      setPinLat(lat);
      setPinLng(lng);
      setAccuracyM(pos.coords.accuracy ?? null);
      setLocationSource("gps");
    } catch (e: unknown) {
      Alert.alert(
        t("locationPicker.gpsErrorTitle", "GPS error"),
        toUserFacingError(e, t("locationPicker.gpsErrorBody", "Unable to read GPS")),
      );
    } finally {
      setLoadingGps(false);
    }
  }

  function handleSelectZone(zone: MmdZone) {
    setRegionName(zone.region_name ?? regionName);
    setPrefectureName(zone.prefecture_name ?? prefectureName);
    setCityName(zone.city_name ?? cityName);
    setCommuneName(zone.commune_name ?? "");
    setQuartierName(zone.quartier_name ?? "");
  }

  function handleSelectLandmark(landmark: MmdLandmark) {
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
    setPinLng(coords[0]);
    setPinLat(coords[1]);
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
          directions_text: directionsText.trim(),
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
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text
          style={{
            color: MMD_WHITE,
            fontSize: 24,
            fontWeight: "700",
            fontFamily: MMD_FONT.bold,
          }}
        >
          {title}
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
              Cancel
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={{ color: MMD_MUTED, fontSize: 14, fontFamily: MMD_FONT.regular }}>
        {structuredMode
          ? "Enter your street number, city, and ZIP, then place the pin on the exact entrance."
          : requirePinConfirm
            ? "Tap the map to place your pin, confirm it, and add a landmark or directions so the driver can find you."
            : "Tap the map to place your exact pin. Describe the place so the driver can find you even without a street number."}
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
              Map unavailable. Configure EXPO_PUBLIC_MAPBOX_TOKEN to use the location picker.
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
            <Mapbox.PointAnnotation id="mmd-location-pin" coordinate={mapCenter}>
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
          </Mapbox.MapView>
        )}
      </View>

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
            Use my current GPS
          </Text>
        )}
      </TouchableOpacity>

      {accuracyM != null ? (
        <Text style={{ color: MMD_MUTED, fontSize: 13, fontFamily: MMD_FONT.regular }}>
          GPS accuracy: ~{Math.round(accuracyM)} m · Pin: {pinLat.toFixed(5)}, {pinLng.toFixed(5)}
        </Text>
      ) : (
        <Text style={{ color: MMD_MUTED, fontSize: 13, fontFamily: MMD_FONT.regular }}>
          Pin: {pinLat.toFixed(5)}, {pinLng.toFixed(5)} · source: {locationSource}
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
              ? "Pin confirmed"
              : "Confirm pin location"}
          </Text>
        </TouchableOpacity>
      ) : null}

      {zones.length > 0 && !structuredMode ? (
        <View style={{ gap: 8 }}>
          <FieldLabel>{`Zone (${scopedCountryCode})`}</FieldLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection: "row", gap: 8 }}>
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
            <FieldLabel>Street number *</FieldLabel>
            <FieldInput
              value={streetNumber}
              onChangeText={setStreetNumber}
              placeholder="123"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View>
            <FieldLabel>City *</FieldLabel>
            <FieldInput
              value={cityName}
              onChangeText={setCityName}
              placeholder="New York"
            />
          </View>
          <View>
            <FieldLabel>ZIP / Postal code *</FieldLabel>
            <FieldInput
              value={postalCode}
              onChangeText={setPostalCode}
              placeholder="10001"
              autoCapitalize="characters"
            />
          </View>
          <View>
            <FieldLabel>Street / place name (optional)</FieldLabel>
            <FieldInput
              value={formattedAddress}
              onChangeText={setFormattedAddress}
              placeholder="Main St / building name"
            />
          </View>
        </View>
      ) : (
        <>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <FieldLabel>Commune</FieldLabel>
          <FieldInput value={communeName} onChangeText={setCommuneName} placeholder="Matoto" />
        </View>
        <View style={{ flex: 1 }}>
          <FieldLabel>Quartier</FieldLabel>
          <FieldInput value={quartierName} onChangeText={setQuartierName} placeholder="Lambanyi" />
        </View>
      </View>

      <View>
        <FieldLabel>{requireLandmark ? "Landmark search *" : "Landmark search"}</FieldLabel>
        <FieldInput
          value={landmarkQuery}
          onChangeText={(text) => {
            setLandmarkQuery(text);
            setSelectedLandmark(null);
          }}
          placeholder="Station Total, mosquée, marché..."
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
        <FieldLabel>Formatted address (optional)</FieldLabel>
        <FieldInput
          value={formattedAddress}
          onChangeText={setFormattedAddress}
          placeholder="Street or place name if known"
        />
      </View>

      <View>
        <FieldLabel>Describe your exact location *</FieldLabel>
        <FieldInput
          value={directionsText}
          onChangeText={setDirectionsText}
          placeholder="After Total station, second road on the right, yellow house with blue gate..."
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
            Minimum 8 characters required.
          </Text>
        ) : null}
      </View>
        </>
      )}

      <View style={{ gap: 8 }}>
        <FieldLabel>Photo of the place (recommended)</FieldLabel>
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
            {photoUri ? "Retake location photo" : "Add photo of gate, shop, or building"}
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
              {submitLabel}
            </Text>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}
