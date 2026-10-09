import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import * as Location from "expo-location";
import Mapbox from "@rnmapbox/maps";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import { formatMoneyFromCents } from "../../i18n/formatters";
import { createTaxiRide, quoteTaxiRide } from "../../lib/taxiClientApi";
import {
  ensureMapboxTokenApplied,
  isMapboxConfigured,
  MAP_STYLE_STREETS,
} from "../../lib/mapboxConfig";
import {
  searchMapboxPlaces,
  type MapboxPlaceSuggestion,
} from "../../lib/mapboxPlaces";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD,
  MMD_MUTED,
  MMD_NAVY,
  MMD_WHITE,
} from "../../theme/mmdUi";

const LOGO = require("../../../assets/brand/mmd-logo-ui.png");
const GUINEA_CAMERA = { latitude: 10.2, longitude: -11.0 };

type Step = "pickup" | "destination" | "confirm";
type Mode = "gps" | "map" | "search";
type PlacePoint = {
  latitude: number;
  longitude: number;
  label: string | null;
};

type QuoteView = {
  fareLabel: string;
  distanceKm: number;
  durationMinutes: number;
  geometry: { type: "LineString"; coordinates: number[][] } | null;
};

function quoteErrorMessage(
  code: string,
  t: (key: string, fallback: string) => string,
): string {
  if (code === "guinea_pricing_not_configured") {
    return t(
      "taxiGuinea.pricingUnavailable",
      "The Guinea fare is not configured yet. The trip was not priced.",
    );
  }
  if (code === "outside_guinea" || code === "market_mismatch") {
    return t(
      "taxiGuinea.outsideGuinea",
      "Pickup and destination must both be in Guinea.",
    );
  }
  if (code === "taxi_distance_too_far") {
    return t("taxiGuinea.routeUnavailable", "The route could not be calculated.");
  }
  if (code === "guinea_standard_distance_exceeded") {
    return t(
      "taxiGuinea.distanceExceeded",
      "This trip is longer than 100 km. Standard pricing does not apply. Use XL interregional when that axis is available.",
    );
  }
  if (code === "guinea_capacity_exceeded") {
    return t("taxiGuinea.capacityExceeded", "This vehicle cannot take that many passengers.");
  }
  if (code === "guinea_motorcycle_pool_forbidden") {
    return t("taxiGuinea.motorcyclePool", "A motorcycle cannot be shared.");
  }
  if (code === "guinea_commission_not_configured") {
    return t(
      "taxiGuinea.commissionUnavailable",
      "The Guinea commission is not configured yet. The trip was not priced.",
    );
  }
  return t("taxiGuinea.requestFailed", "The request could not be sent.");
}

function formatCoordinates(point: PlacePoint): string {
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

export default function GuineaTaxiRequestScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [step, setStep] = useState<Step>("pickup");
  const [mode, setMode] = useState<Mode>("gps");
  const [pickup, setPickup] = useState<PlacePoint | null>(null);
  const [destination, setDestination] = useState<PlacePoint | null>(null);
  const [draft, setDraft] = useState<PlacePoint | null>(null);
  const [camera, setCamera] = useState(GUINEA_CAMERA);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapboxPlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<QuoteView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    ensureMapboxTokenApplied();
    setMapReady(true);
  }, []);

  const activePoint = step === "destination" ? destination ?? draft : pickup ?? draft;

  const placeLabel = useCallback(
    (point: PlacePoint | null) =>
      point?.label ||
      (point ? formatCoordinates(point) : t("taxiGuinea.noPlaceYet", "Not selected")),
    [t],
  );

  const useCurrentLocation = useCallback(async () => {
    setError(null);
    setMode("gps");
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setError(t("taxiGuinea.locationDenied", "Location permission is required for this option."));
      return;
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const point = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      label: null,
    };
    setDraft(point);
    setCamera({ latitude: point.latitude, longitude: point.longitude });
  }, [t]);

  useEffect(() => {
    void useCurrentLocation();
  }, [useCurrentLocation]);

  useEffect(() => {
    if (mode !== "search" || query.trim().length < 3) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void searchMapboxPlaces({
        query,
        country: "GN",
        proximity: draft
          ? { lat: draft.latitude, lng: draft.longitude }
          : { lat: camera.latitude, lng: camera.longitude },
        signal: controller.signal,
      })
        .then((places) => setResults(places))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [camera.latitude, camera.longitude, draft, mode, query]);

  const line = useMemo(() => {
    if (!quote?.geometry || quote.geometry.coordinates.length < 2) return null;
    return {
      type: "Feature" as const,
      geometry: quote.geometry,
      properties: {},
    };
  }, [quote]);

  async function loadQuote(nextPickup: PlacePoint, nextDestination: PlacePoint) {
    setBusy(true);
    setError(null);
    try {
      const result = await quoteTaxiRide({
        pickupLat: nextPickup.latitude,
        pickupLng: nextPickup.longitude,
        dropoffLat: nextDestination.latitude,
        dropoffLng: nextDestination.longitude,
        pickupAddress: nextPickup.label ?? undefined,
        dropoffAddress: nextDestination.label ?? undefined,
        vehicleClass: "standard",
        countryCode: "GN",
        tripMode: "one_way",
        passengerCount: 1,
      });
      if (!result?.ok || result.market !== "GN") {
        throw new Error(String(result?.error ?? "quote_failed"));
      }
      const priced = result.quote as { total_cents?: number; distance_km?: number; duration_minutes?: number };
      const route = result.route as { geometry?: QuoteView["geometry"] };
      setQuote({
        fareLabel: formatMoneyFromCents(
          Number(priced.total_cents ?? 0),
          "GNF",
          i18n.language,
        ),
        distanceKm: Number(priced.distance_km ?? 0),
        durationMinutes: Math.round(Number(priced.duration_minutes ?? 0)),
        geometry: route.geometry ?? null,
      });
      setStep("confirm");
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "quote_failed";
      setError(quoteErrorMessage(code, t));
    } finally {
      setBusy(false);
    }
  }

  function confirmPoint() {
    if (!draft) return;
    if (step === "pickup") {
      setPickup(draft);
      setDestination(null);
      setQuote(null);
      setStep("destination");
      setMode("map");
      return;
    }
    if (!pickup) return;
    setDestination(draft);
    void loadQuote(pickup, draft);
  }

  async function confirmRequest() {
    if (!pickup || !destination || !quote) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createTaxiRide({
        pickupLat: pickup.latitude,
        pickupLng: pickup.longitude,
        dropoffLat: destination.latitude,
        dropoffLng: destination.longitude,
        pickupAddress: pickup.label ?? undefined,
        dropoffAddress: destination.label ?? undefined,
        vehicleClass: "standard",
        countryCode: "GN",
        tripMode: "one_way",
        passengerCount: 1,
        paymentMethod: "cash",
        clientNotes: note.trim(),
      });
      const rideId = String(created?.ride?.id ?? "");
      if (!created?.ok || !rideId) {
        throw new Error(String(created?.error ?? "create_failed"));
      }
      navigation.replace("TaxiRideTracking", { rideId });
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "create_failed";
      setError(quoteErrorMessage(code, t));
    } finally {
      setBusy(false);
    }
  }

  const title =
    step === "pickup"
      ? t("taxiGuinea.choosePickup", "Choose the pickup")
      : step === "destination"
        ? t("taxiGuinea.chooseDestination", "Choose the destination")
        : t("taxiGuinea.detailsTitle", "Details and confirmation");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#F4F7FB" }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
            <Text style={{ color: MMD_NAVY, fontSize: 22, fontFamily: MMD_FONT.bold }}>‹</Text>
          </TouchableOpacity>
          <Image source={LOGO} resizeMode="contain" style={{ width: 132, height: 36 }} />
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: MMD_WHITE,
              borderRadius: 14,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <Text style={{ fontSize: 16 }}>🇬🇳</Text>
            <Text style={{ marginLeft: 6, color: MMD_NAVY, fontFamily: MMD_FONT.semibold, fontSize: 12 }}>
              {t("taxiGuinea.marketGuinea", "Guinea")}
            </Text>
          </View>
        </View>
        <Text style={{ marginTop: 12, color: MMD_NAVY, fontSize: 22, fontFamily: MMD_FONT.extrabold }}>
          {title}
        </Text>
        <Text style={{ color: MMD_MUTED, marginTop: 2, fontFamily: MMD_FONT.regular }}>
          {step === "confirm"
            ? t("taxiGuinea.detailsSubtitle", "Route, price in GNF and cash payment")
            : t("taxiGuinea.methodSubtitle", "My location, map or search")}
        </Text>
      </View>

      <View style={{ flex: 1, marginHorizontal: 12, borderRadius: 18, overflow: "hidden" }}>
        {mapReady && isMapboxConfigured() ? (
          <Mapbox.MapView
            style={{ flex: 1 }}
            styleURL={MAP_STYLE_STREETS}
            onCameraChanged={(event) => {
              if (step === "confirm" || mode !== "map") return;
              const center = event.properties?.center;
              if (!center) return;
              setDraft({
                latitude: center[1],
                longitude: center[0],
                label: null,
              });
            }}
          >
            <Mapbox.Camera
              zoomLevel={step === "confirm" ? 11 : 14}
              centerCoordinate={[camera.longitude, camera.latitude]}
              animationMode="flyTo"
              animationDuration={400}
            />
            {pickup ? (
              <Mapbox.PointAnnotation id="gn-pickup" coordinate={[pickup.longitude, pickup.latitude]}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: MMD_BLUE, borderWidth: 2, borderColor: MMD_WHITE }} />
              </Mapbox.PointAnnotation>
            ) : null}
            {destination ? (
              <Mapbox.PointAnnotation id="gn-destination" coordinate={[destination.longitude, destination.latitude]}>
                <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: "#E11D48", borderWidth: 2, borderColor: MMD_WHITE }} />
              </Mapbox.PointAnnotation>
            ) : null}
            {line ? (
              <Mapbox.ShapeSource id="gn-route" shape={line}>
                <Mapbox.LineLayer
                  id="gn-route-line"
                  style={{ lineColor: MMD_BLUE, lineWidth: 5, lineCap: "round", lineJoin: "round" }}
                />
              </Mapbox.ShapeSource>
            ) : null}
          </Mapbox.MapView>
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: MMD_MUTED, textAlign: "center", padding: 24 }}>
              {t("locationPicker.mapUnavailable", "Map unavailable. Configure EXPO_PUBLIC_MAPBOX_TOKEN to use the location picker.")}
            </Text>
          </View>
        )}
        {step !== "confirm" && mode === "map" ? (
          <View pointerEvents="none" style={{ position: "absolute", top: "46%", left: "50%", marginLeft: -10, marginTop: -22 }}>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: step === "pickup" ? MMD_BLUE : "#E11D48", borderWidth: 3, borderColor: MMD_WHITE }} />
          </View>
        ) : null}
      </View>

      <ScrollView style={{ maxHeight: step === "confirm" ? 430 : 280 }} contentContainerStyle={{ padding: 16 }}>
        {error ? (
          <Text style={{ color: "#B91C1C", marginBottom: 8, fontFamily: MMD_FONT.semibold }}>{error}</Text>
        ) : null}

        {step !== "confirm" ? (
          <>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <ModeButton
                selected={mode === "gps"}
                label={t("taxiGuinea.currentLocation", "My current location")}
                onPress={() => void useCurrentLocation()}
              />
              <ModeButton
                selected={mode === "map"}
                label={t("taxiGuinea.chooseOnMap", "Choose on the map")}
                onPress={() => setMode("map")}
              />
              <ModeButton
                selected={mode === "search"}
                label={t("taxiGuinea.searchPlace", "Search for a place")}
                onPress={() => setMode("search")}
              />
            </View>
            {mode === "search" ? (
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t(
                  "taxiGuinea.searchPlaceholder",
                  "Example: market, hospital, mosque, restaurant, school...",
                )}
                placeholderTextColor="#94A3B8"
                style={{
                  marginTop: 10,
                  backgroundColor: MMD_WHITE,
                  borderRadius: 14,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  fontFamily: MMD_FONT.regular,
                }}
              />
            ) : null}
            {searching ? <ActivityIndicator style={{ marginTop: 8 }} color={MMD_BLUE} /> : null}
            {results.map((place) => (
              <TouchableOpacity
                key={place.id}
                onPress={() => {
                  const point = {
                    latitude: place.latitude,
                    longitude: place.longitude,
                    label: place.name || place.fullAddress,
                  };
                  setDraft(point);
                  setCamera({ latitude: point.latitude, longitude: point.longitude });
                  setQuery(point.label ?? "");
                }}
                style={{ marginTop: 8, backgroundColor: MMD_WHITE, borderRadius: 12, padding: 12 }}
              >
                <Text style={{ color: MMD_NAVY, fontFamily: MMD_FONT.semibold }}>{place.name}</Text>
                <Text style={{ color: MMD_MUTED, fontFamily: MMD_FONT.regular }}>{place.fullAddress}</Text>
              </TouchableOpacity>
            ))}
            <View style={{ marginTop: 12, backgroundColor: MMD_WHITE, borderRadius: 16, padding: 14 }}>
              <Text style={{ color: MMD_NAVY, fontFamily: MMD_FONT.bold }}>
                {step === "pickup"
                  ? t("taxiGuinea.pickupSelected", "Pickup selected")
                  : t("taxiGuinea.destinationSelected", "Destination selected")}
              </Text>
              <Text style={{ marginTop: 4, color: "#334155", fontFamily: MMD_FONT.regular }}>
                {placeLabel(draft ?? activePoint)}
              </Text>
              {draft ? (
                <Text style={{ marginTop: 2, color: MMD_MUTED, fontFamily: MMD_FONT.regular }}>
                  {formatCoordinates(draft)}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              disabled={!draft || busy}
              onPress={confirmPoint}
              style={{
                marginTop: 12,
                backgroundColor: !draft || busy ? "#E5E7EB" : MMD_GOLD,
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: "center",
              }}
            >
              {busy ? (
                <ActivityIndicator color={MMD_NAVY} />
              ) : (
                <Text style={{ color: MMD_NAVY, fontFamily: MMD_FONT.extrabold, fontSize: 16 }}>
                  {step === "pickup"
                    ? t("taxiGuinea.confirmPickup", "Confirm pickup")
                    : t("taxiGuinea.confirmDestination", "Confirm destination")}
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={{ backgroundColor: MMD_WHITE, borderRadius: 18, padding: 16 }}>
              <Text style={{ color: MMD_NAVY, fontFamily: MMD_FONT.extrabold, fontSize: 18 }}>
                {t("taxiGuinea.tripDetails", "Trip details")}
              </Text>
              <Detail
                label={t("taxiGuinea.pickup", "Pickup")}
                value={placeLabel(pickup)}
                onEdit={() => {
                  setStep("pickup");
                  setQuote(null);
                }}
                editLabel={t("taxiGuinea.modify", "Edit")}
              />
              <Detail
                label={t("taxiGuinea.destination", "Destination")}
                value={placeLabel(destination)}
                onEdit={() => {
                  setStep("destination");
                  setQuote(null);
                }}
                editLabel={t("taxiGuinea.modify", "Edit")}
              />
              <Detail
                label={t("taxiGuinea.distance", "Distance")}
                value={t("taxiGuinea.kilometers", "{{value}} km", {
                  value: quote?.distanceKm ?? 0,
                })}
              />
              <Detail
                label={t("taxiGuinea.estimatedTime", "Estimated time")}
                value={t("taxiGuinea.minutesLong", "{{value}} minutes", {
                  value: quote?.durationMinutes ?? 0,
                })}
              />
              <Detail
                label={t("taxiGuinea.estimatedFare", "Estimated fare")}
                value={quote?.fareLabel ?? ""}
              />
            </View>
            <Text style={{ marginTop: 14, color: MMD_NAVY, fontFamily: MMD_FONT.bold }}>
              {t("taxiGuinea.driverNote", "Note for the driver")}
            </Text>
            <TextInput
              value={note}
              onChangeText={(value) => setNote(value.slice(0, 200))}
              multiline
              placeholder={t(
                "taxiGuinea.driverNotePlaceholder",
                "Example: blue house next to the pharmacy, call me when you arrive...",
              )}
              placeholderTextColor="#94A3B8"
              style={{
                marginTop: 8,
                minHeight: 72,
                backgroundColor: MMD_WHITE,
                borderRadius: 14,
                padding: 12,
                textAlignVertical: "top",
                fontFamily: MMD_FONT.regular,
              }}
            />
            <Text style={{ alignSelf: "flex-end", color: MMD_MUTED }}>{note.length}/200</Text>
            <View style={{ marginTop: 8, backgroundColor: "#E5E7EB", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#64748B", fontFamily: MMD_FONT.semibold }}>
                {t("taxiGuinea.voiceUnavailable", "Voice note — not available yet")}
              </Text>
            </View>
            <Text style={{ marginTop: 14, color: MMD_NAVY, fontFamily: MMD_FONT.bold }}>
              {t("taxiGuinea.payment", "Payment")}
            </Text>
            <View style={{ marginTop: 8, backgroundColor: "#ECFDF5", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: MMD_NAVY, fontFamily: MMD_FONT.bold }}>
                {t("taxiGuinea.cash", "Cash")}
              </Text>
              <Text style={{ color: "#047857", fontFamily: MMD_FONT.regular }}>
                {t("taxiGuinea.cashHint", "Pay the driver in cash")}
              </Text>
            </View>
            <View style={{ marginTop: 8, backgroundColor: "#F1F5F9", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#64748B", fontFamily: MMD_FONT.semibold }}>
                {t("taxiGuinea.orangeMoney", "Orange Money")}
              </Text>
              <Text style={{ color: "#94A3B8" }}>
                {t("taxiGuinea.comingSoon", "Coming soon")}
              </Text>
            </View>
            <TouchableOpacity
              disabled={busy}
              onPress={() => void confirmRequest()}
              style={{
                marginTop: 14,
                backgroundColor: MMD_GOLD,
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: "center",
              }}
            >
              {busy ? (
                <ActivityIndicator color={MMD_NAVY} />
              ) : (
                <Text style={{ color: MMD_NAVY, fontFamily: MMD_FONT.extrabold, fontSize: 16 }}>
                  {t("taxiGuinea.confirmRequest", "Confirm the request")}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ModeButton({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flex: 1,
        backgroundColor: selected ? MMD_BLUE : MMD_WHITE,
        borderRadius: 14,
        minHeight: 72,
        padding: 8,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          color: selected ? MMD_WHITE : MMD_NAVY,
          textAlign: "center",
          fontFamily: MMD_FONT.semibold,
          fontSize: 12,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Detail({
  label,
  value,
  onEdit,
  editLabel,
}: {
  label: string;
  value: string;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: MMD_MUTED, fontFamily: MMD_FONT.regular }}>{label}</Text>
        <Text style={{ color: MMD_NAVY, fontFamily: MMD_FONT.bold }}>{value}</Text>
      </View>
      {onEdit ? (
        <TouchableOpacity onPress={onEdit}>
          <Text style={{ color: MMD_BLUE, fontFamily: MMD_FONT.semibold }}>{editLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
