import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  TouchableOpacity,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useTranslation } from "react-i18next";
import { useKeepAwake } from "expo-keep-awake";
import { supabase } from "../lib/supabase";
import { getDriverOnlineStatus } from "../lib/driverStatus";
import {
  ensureMapboxTokenApplied,
  isMapboxConfigured,
  MAP_STYLE_DARK,
  MAP_STYLE_STREETS,
} from "../lib/mapboxConfig";
import { fitCameraToRoute } from "../lib/navigationService";
import { buildNavigationInstruction } from "../lib/navigationInstructions";
import {
  resolveNavigationVoiceLanguage,
  speakArrival,
  speakNavigationProgress,
  speakReroute,
  stopNavigationVoice,
} from "../lib/navigationVoice";
import {
  numberOrNull,
  toCoordinatePoint,
} from "../lib/coordinates";
import type {
  NavigationStage,
  NavigationTrip,
  OrderSourceTable,
} from "../lib/driverNavigation/types";
import {
  appendDriverTripHistory,
  createTripHistorySession,
  finalizeTripHistorySession,
  updateTripHistorySessionPoint,
  type TripHistorySession,
} from "../lib/driverTripHistory";
import { useDriverMapLocation } from "../hooks/useDriverMapLocation";
import { useDriverNavigationRoute } from "../hooks/useDriverNavigationRoute";
import { useDriverNavigationCamera } from "../hooks/useDriverNavigationCamera";
import { useArrivalGeofence } from "../hooks/useArrivalGeofence";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { DriverNavigationHud } from "../components/driver/DriverNavigationHud";
import { DriverNavigationControls } from "../components/driver/DriverNavigationControls";
import { DriverNavigationBottomBar } from "../components/driver/DriverNavigationBottomBar";
import { DriverNavigationRouteAlternatives } from "../components/driver/DriverNavigationRouteAlternatives";
import { DriverArrivalBanner } from "../components/driver/DriverArrivalBanner";
import { DriverMapFallbackStates } from "../components/driver/DriverMapFallbackStates";
import { DriverReportButton } from "../components/driver/DriverReportButton";
import { DriverTripLocationCard } from "../components/location/DriverTripLocationCard";
import { useNearbyDriverMapReports } from "../hooks/useNearbyDriverMapReports";
import { useDriverTripHistory } from "../hooks/useDriverTripHistory";
import { useDriverMapCountryCode } from "../hooks/useDriverMapCountryCode";
import {
  countryCodeFromMarketplaceNavRow,
  coordsFromLocationJoin,
  MARKETPLACE_DELIVERY_JOB_NAV_SELECT,
  marketplaceDriverPayoutDollars,
} from "../lib/marketplaceDriverNavigation";
import { extractCountryCodeField } from "../lib/driverNavigation/reports/resolveCountryCode";
import type { DriverMapReportSourceTable } from "../lib/driverNavigation/reports/config";
import { DEFAULT_DRIVER_MAP_REPORT_CONTEXT } from "../lib/driverNavigation/reports/config";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverMap">;

type DriverMapRouteParams = {
  orderId?: string;
  order_id?: string;
  sourceTable?: OrderSourceTable;
  source_table?: OrderSourceTable;
  destinationStage?: NavigationStage;
  destination_stage?: NavigationStage;
};

function normalizeSourceTable(value: unknown): OrderSourceTable {
  if (value === "delivery_requests") return "delivery_requests";
  if (value === "taxi_rides") return "taxi_rides";
  if (value === "marketplace_delivery_jobs") return "marketplace_delivery_jobs";
  return "orders";
}

function normalizeStage(value: unknown): NavigationStage {
  return value === "dropoff" ? "dropoff" : "pickup";
}

function getDriverPayout(row: Record<string, unknown>) {
  const marketplaceCents = numberOrNull(row.driver_earning_cents);
  if (marketplaceCents != null) return marketplaceCents / 100;

  const taxiCents = numberOrNull(row.driver_payout_cents);
  if (taxiCents != null) return taxiCents / 100;

  const candidates = [
    row.driver_delivery_payout,
    row.driver_payout,
    row.driver_amount,
    row.estimated_driver_payout,
  ];

  for (const candidate of candidates) {
    const value = numberOrNull(candidate);
    if (value != null) return value;
  }

  return 0;
}

function buildTripFromRow(params: {
  row: Record<string, unknown>;
  sourceTable: OrderSourceTable;
  stage: NavigationStage;
}): NavigationTrip {
  const { row, sourceTable, stage } = params;
  const pickupLng = numberOrNull(
    row.pickup_lng ?? row.pickup_lon ?? row.pickup_longitude,
  );
  const dropoffLng = numberOrNull(
    row.dropoff_lng ?? row.dropoff_lon ?? row.dropoff_longitude,
  );
  const pickupFromLocation = coordsFromLocationJoin(row.pickup);
  const dropoffFromLocation = coordsFromLocationJoin(row.dropoff);
  const sellers = row.sellers as
    | { business_name?: unknown }
    | { business_name?: unknown }[]
    | null;
  const seller = Array.isArray(sellers) ? sellers[0] : sellers;

  return {
    orderId: String(row.id ?? ""),
    sourceTable,
    restaurantName:
      String(row.restaurant_name || "").trim() ||
      String(seller?.business_name || "").trim() ||
      (sourceTable === "delivery_requests"
        ? "MMD Delivery"
        : sourceTable === "taxi_rides"
          ? "MMD Taxi"
          : sourceTable === "marketplace_delivery_jobs"
            ? "Marketplace"
            : "Restaurant"),
    pickupAddress: String(row.pickup_address || "Pickup location"),
    dropoffAddress: String(row.dropoff_address || "Dropoff location"),
    pickup:
      toCoordinatePoint(row.pickup_lat, pickupLng) ?? pickupFromLocation,
    dropoff:
      toCoordinatePoint(row.dropoff_lat, dropoffLng) ?? dropoffFromLocation,
    stage,
    price:
      sourceTable === "marketplace_delivery_jobs"
        ? marketplaceDriverPayoutDollars(row)
        : getDriverPayout(row),
    distanceMiles:
      numberOrNull(row.distance_miles) ??
      numberOrNull(row.estimated_distance_miles) ??
      0,
    etaMinutes:
      numberOrNull(row.eta_minutes) ??
      numberOrNull(row.duration_minutes) ??
      numberOrNull(row.estimated_minutes) ??
      0,
    orderCountryCode:
      extractCountryCodeField(row) ?? countryCodeFromMarketplaceNavRow(row),
    pickupLocationId: row.pickup_location_id
      ? String(row.pickup_location_id)
      : null,
    dropoffLocationId: row.dropoff_location_id
      ? String(row.dropoff_location_id)
      : null,
  };
}

export default function DriverMapScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<RootStackParamList, "DriverMap">>();
  const { t, i18n } = useTranslation();

  useKeepAwake();

  const routeParams = (route.params ?? {}) as DriverMapRouteParams;
  const routeOrderId = String(
    routeParams.orderId ?? routeParams.order_id ?? "",
  ).trim();
  const routeSourceTable = normalizeSourceTable(
    routeParams.sourceTable ?? routeParams.source_table,
  );
  const routeStage = normalizeStage(
    routeParams.destinationStage ?? routeParams.destination_stage,
  );

  const mapboxReady = isMapboxConfigured();
  if (mapboxReady) {
    ensureMapboxTokenApplied();
  }

  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const hasFitRouteRef = useRef(false);
  const arrivalVoiceRef = useRef<{ pickup: boolean; dropoff: boolean }>({
    pickup: false,
    dropoff: false,
  });
  const tripSessionRef = useRef<TripHistorySession | null>(null);

  const [isOnline, setIsOnline] = useState(false);
  const [trip, setTrip] = useState<NavigationTrip | null>(null);
  const [orderLoading, setOrderLoading] = useState(true);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [isNightMode] = useState(() => {
    const hour = new Date().getHours();
    return hour >= 19 || hour < 6;
  });

  const location = useDriverMapLocation(mapboxReady && !!trip);
  const network = useNetworkStatus();
  const tripHistory = useDriverTripHistory();

  const reportCountry = useDriverMapCountryCode({
    driverId,
    orderId: trip?.orderId ?? null,
    sourceTable: trip?.sourceTable ?? null,
    orderCountryCode: trip?.orderCountryCode,
  });

  const nearbyReports = useNearbyDriverMapReports({
    enabled: mapboxReady && !!trip && !!location.point && !reportCountry.isLoading,
    latitude: location.point?.latitude ?? null,
    longitude: location.point?.longitude ?? null,
    moduleType: DEFAULT_DRIVER_MAP_REPORT_CONTEXT.moduleType,
    countryCode: reportCountry.countryCode,
  });

  const activeDestination = useMemo(() => {
    if (!trip) return null;
    return trip.stage === "dropoff" ? trip.dropoff : trip.pickup;
  }, [trip]);

  const activeLocationId = useMemo(() => {
    if (!trip) return null;
    return trip.stage === "dropoff"
      ? trip.dropoffLocationId ?? null
      : trip.pickupLocationId ?? null;
  }, [trip]);

  const destinationAddress =
    trip?.stage === "dropoff"
      ? trip.dropoffAddress
      : trip?.pickupAddress ?? "";

  const voiceLanguage = resolveNavigationVoiceLanguage(i18n.language);

  const handleReroute = useCallback(() => {
    if (!voiceEnabled) return;
    void speakReroute(voiceLanguage);
  }, [voiceEnabled, voiceLanguage]);

  const routeState = useDriverNavigationRoute({
    enabled: mapboxReady && !!trip && !!location.point && !!activeDestination,
    driverPoint: location.point,
    destination: activeDestination,
    stage: trip?.stage ?? "pickup",
    language: i18n.language,
    onNetworkFailure: network.reportFailure,
    onNetworkSuccess: network.reportSuccess,
    onReroute: handleReroute,
  });

  const navigationActive = Boolean(routeState.route?.geometry);
  const camera = useDriverNavigationCamera({
    cameraRef,
    driverPoint: location.point,
    heading: location.heading,
    navigationActive,
    enabled: mapboxReady && !!location.point,
  });

  const focusLocationPin = useCallback(
    (coords: { lat: number; lng: number }) => {
      camera.setFreeMode();
      cameraRef.current?.setCamera({
        centerCoordinate: [coords.lng, coords.lat],
        zoomLevel: 17,
        animationDuration: 600,
        animationMode: "flyTo",
      });
    },
    [camera]
  );

  const arrival = useArrivalGeofence({
    enabled: !!trip && !!location.point,
    driverPoint: location.point,
    stage: trip?.stage ?? "pickup",
    pickup: trip?.pickup ?? null,
    dropoff: trip?.dropoff ?? null,
  });

  const instruction = useMemo(() => {
    if (!trip || !routeState.route) return null;

    return buildNavigationInstruction({
      remainingMeters: routeState.remainingMeters,
      stage: trip.stage,
      steps: routeState.route.steps,
      locale: i18n.language,
    });
  }, [i18n.language, routeState.remainingMeters, routeState.route, trip]);

  useEffect(() => {
    void getDriverOnlineStatus().then(setIsOnline).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled || error || !data?.user) return;
      setDriverId(data.user.id);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      void stopNavigationVoice();
      const session = tripSessionRef.current;
      if (session) {
        void appendDriverTripHistory(finalizeTripHistorySession(session)).then(() => {
          void tripHistory.refresh();
        });
        tripSessionRef.current = null;
      }
    };
  }, []);

  const loadTrip = useCallback(async () => {
    if (!routeOrderId) {
      setOrderError(
        t(
          "driver.map.orderNotFound",
          "Ouvre la navigation depuis les détails de commande.",
        ),
      );
      setOrderLoading(false);
      return;
    }

    setOrderLoading(true);
    setOrderError(null);

    try {
      const result =
        routeSourceTable === "marketplace_delivery_jobs"
          ? await supabase
              .from("marketplace_delivery_jobs")
              .select(MARKETPLACE_DELIVERY_JOB_NAV_SELECT)
              .eq("id", routeOrderId)
              .maybeSingle()
          : routeSourceTable === "delivery_requests"
            ? await supabase
                .from("delivery_requests")
                .select(
                  "id,status,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,distance_miles,eta_minutes,driver_delivery_payout,dropoff_location_id",
                )
                .eq("id", routeOrderId)
                .maybeSingle()
            : routeSourceTable === "taxi_rides"
              ? await supabase
                  .from("taxi_rides")
                  .select(
                    "id,status,pickup_address,dropoff_address,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,distance_miles,duration_minutes,driver_payout_cents,country_code,pickup_location_id,dropoff_location_id",
                  )
                  .eq("id", routeOrderId)
                  .maybeSingle()
              : await supabase
                  .from("orders")
                  .select(
                    "id,status,restaurant_name,pickup_address,dropoff_address,pickup_lat,pickup_lng,pickup_lon,dropoff_lat,dropoff_lng,dropoff_lon,distance_miles,eta_minutes,driver_delivery_payout",
                  )
                  .eq("id", routeOrderId)
                  .maybeSingle();

      if (result.error) throw result.error;
      if (!result.data) {
        setOrderError(t("driver.map.orderNotFound", "Course introuvable."));
        setTrip(null);
        return;
      }

      const nextTrip = buildTripFromRow({
        row: result.data as Record<string, unknown>,
        sourceTable: routeSourceTable,
        stage: routeStage,
      });

      const hasStageCoords =
        nextTrip.stage === "dropoff"
          ? !!nextTrip.dropoff
          : !!nextTrip.pickup;

      if (!hasStageCoords) {
        setOrderError(
          t(
            "driver.map.missingCoords",
            "Coordonnées GPS manquantes pour cette étape.",
          ),
        );
        setTrip(null);
        return;
      }

      setTrip(nextTrip);
      tripSessionRef.current = createTripHistorySession({
        orderId: nextTrip.orderId,
        sourceTable: nextTrip.sourceTable,
        stage: nextTrip.stage,
        restaurantName: nextTrip.restaurantName,
        pickupAddress: nextTrip.pickupAddress,
        dropoffAddress: nextTrip.dropoffAddress,
      });
      hasFitRouteRef.current = false;
      arrivalVoiceRef.current = { pickup: false, dropoff: false };
    } catch (error) {
      setOrderError(
        error instanceof Error
          ? error.message
          : t("driver.map.orderLoadError", "Impossible de charger la course."),
      );
      setTrip(null);
    } finally {
      setOrderLoading(false);
    }
  }, [routeOrderId, routeSourceTable, routeStage, t]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  useEffect(() => {
    if (!location.point || !tripSessionRef.current) return;
    tripSessionRef.current = updateTripHistorySessionPoint(
      tripSessionRef.current,
      location.point,
    );
    if (routeState.route?.distanceMeters) {
      tripSessionRef.current.routeDistanceMeters = routeState.route.distanceMeters;
    }
  }, [location.point, routeState.route?.distanceMeters]);

  useEffect(() => {
    if (!routeState.route?.geometry || hasFitRouteRef.current) return;
    if (camera.mode !== "follow") return;

    hasFitRouteRef.current = true;
    void fitCameraToRoute(cameraRef, routeState.route.geometry);
  }, [camera.mode, routeState.route?.geometry]);

  useEffect(() => {
    if (!voiceEnabled || !instruction || !trip) return;

    if (trip.stage === "pickup" && arrival.pickupArrived && !arrivalVoiceRef.current.pickup) {
      arrivalVoiceRef.current.pickup = true;
      void speakArrival("pickup", voiceLanguage);
      return;
    }

    if (
      trip.stage === "dropoff" &&
      arrival.dropoffArrived &&
      !arrivalVoiceRef.current.dropoff
    ) {
      arrivalVoiceRef.current.dropoff = true;
      void speakArrival("dropoff", voiceLanguage);
      return;
    }

    void speakNavigationProgress(instruction.voiceText, voiceLanguage);
  }, [
    arrival.dropoffArrived,
    arrival.pickupArrived,
    instruction,
    trip,
    voiceEnabled,
    voiceLanguage,
  ]);

  const openOrderDetails = useCallback(() => {
    if (!trip) return;
    navigation.navigate("DriverOrderDetails", {
      orderId: trip.orderId,
      sourceTable: trip.sourceTable,
    });
  }, [navigation, trip]);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((current) => {
      if (current) void stopNavigationVoice();
      return !current;
    });
  }, []);

  if (!mapboxReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <DriverMapFallbackStates
          variant="missing_token"
          onGoBack={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  if (orderLoading && !trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <DriverMapFallbackStates variant="loading" />
      </SafeAreaView>
    );
  }

  if (orderError && !trip) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <DriverMapFallbackStates
          variant={routeOrderId ? "missing_order" : "missing_order"}
          message={orderError}
          onGoBack={() => navigation.goBack()}
          onRetry={() => void loadTrip()}
        />
      </SafeAreaView>
    );
  }

  if (trip && !activeDestination) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <DriverMapFallbackStates
          variant="missing_coords"
          onGoBack={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  if (location.permissionStatus !== "granted" && location.errorMessage) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <DriverMapFallbackStates
          variant="permission_denied"
          onGoBack={() => navigation.goBack()}
        />
      </SafeAreaView>
    );
  }

  if (routeState.status === "error" && !routeState.route) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <DriverMapFallbackStates
          variant="route_error"
          onGoBack={() => navigation.goBack()}
          onRetry={routeState.refreshRoute}
        />
      </SafeAreaView>
    );
  }

  const mapStyleURL = isNightMode ? MAP_STYLE_DARK : MAP_STYLE_STREETS;
  const routeLineColor = trip?.stage === "dropoff" ? "#F97316" : "#2563EB";
  const showArrivalBanner =
    (trip?.stage === "pickup" && arrival.pickupArrived) ||
    (trip?.stage === "dropoff" && arrival.dropoffArrived);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <StatusBar barStyle="light-content" />

      <View style={{ flex: 1 }}>
        <Mapbox.MapView
          style={{ flex: 1 }}
          styleURL={mapStyleURL}
          logoEnabled={false}
          attributionEnabled
          compassEnabled
          onTouchStart={camera.setFreeMode}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: location.point
                ? [location.point.longitude, location.point.latitude]
                : [-73.935242, 40.73061],
              zoomLevel: 16,
            }}
          />

          <Mapbox.UserLocation
            visible
            animated
            androidRenderMode="gps"
            showsUserHeadingIndicator
          />

          {routeState.route?.geometry && (
            <Mapbox.ShapeSource
              id="driver-navigation-route-source"
              shape={routeState.route.geometry}
            >
              <Mapbox.LineLayer
                id="driver-navigation-route-casing"
                style={{
                  lineColor: "rgba(15,23,42,0.86)",
                  lineWidth: 8,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
              <Mapbox.LineLayer
                id="driver-navigation-route-line"
                style={{
                  lineColor: routeLineColor,
                  lineWidth: 5,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </Mapbox.ShapeSource>
          )}

          {trip?.pickup && (
            <Mapbox.PointAnnotation
              id="pickup-marker"
              coordinate={[trip.pickup.longitude, trip.pickup.latitude]}
            >
              <View
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "#22C55E",
                  borderWidth: 2,
                  borderColor: "#FFFFFF",
                }}
              >
                <Text style={{ color: "#052E16", fontSize: 10, fontWeight: "900" }}>
                  PICKUP
                </Text>
              </View>
            </Mapbox.PointAnnotation>
          )}

          {trip?.dropoff && (
            <Mapbox.PointAnnotation
              id="dropoff-marker"
              coordinate={[trip.dropoff.longitude, trip.dropoff.latitude]}
            >
              <View
                style={{
                  paddingHorizontal: 9,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: "#F97316",
                  borderWidth: 2,
                  borderColor: "#FFFFFF",
                }}
              >
                <Text style={{ color: "#431407", fontSize: 10, fontWeight: "900" }}>
                  DROPOFF
                </Text>
              </View>
            </Mapbox.PointAnnotation>
          )}
        </Mapbox.MapView>

        <View
          style={{
            position: "absolute",
            top: 44,
            left: 16,
            right: 16,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            activeOpacity={0.85}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "rgba(2,6,23,0.9)",
              borderWidth: 1,
              borderColor: "rgba(148,163,184,0.22)",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "900" }}>‹</Text>
          </TouchableOpacity>

          <View
            pointerEvents="none"
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: isOnline
                ? "rgba(5,46,22,0.88)"
                : "rgba(69,10,10,0.82)",
              borderWidth: 1,
              borderColor: isOnline
                ? "rgba(34,197,94,0.58)"
                : "rgba(251,113,133,0.48)",
            }}
          >
            <Text
              style={{
                color: isOnline ? "#86EFAC" : "#FECACA",
                fontSize: 11,
                fontWeight: "900",
              }}
            >
              {isOnline
                ? t("driver.map.online", "ONLINE")
                : t("driver.map.offline", "OFFLINE")}
            </Text>
          </View>
        </View>

        <DriverNavigationHud
          visible={!!instruction}
          stage={trip?.stage ?? "pickup"}
          instruction={instruction}
          remainingMinutes={routeState.remainingMinutes}
          remainingMeters={routeState.remainingMeters}
          routeLoading={routeState.status === "loading"}
          networkWeak={network.isWeakNetwork || routeState.status === "stale"}
          gpsStatus={location.gpsStatus}
        />

        <DriverNavigationRouteAlternatives
          routes={routeState.routes}
          selectedIndex={routeState.selectedRouteIndex}
          onSelect={routeState.selectRouteIndex}
        />

        <DriverNavigationControls
          topOffset={instruction ? 300 : 112}
          voiceEnabled={voiceEnabled}
          onToggleVoice={toggleVoice}
          onRecenter={camera.recenter}
          onOpenOrderDetails={openOrderDetails}
          stage={trip?.stage ?? "pickup"}
          destination={activeDestination}
          destinationAddress={destinationAddress}
        />

        <DriverArrivalBanner
          visible={showArrivalBanner}
          stage={trip?.stage ?? "pickup"}
          address={destinationAddress}
          onOpenOrderDetails={openOrderDetails}
        />

        {trip && activeLocationId ? (
          <View
            style={{
              position: "absolute",
              left: 14,
              right: 14,
              bottom: 132,
            }}
          >
            <DriverTripLocationCard
              locationId={activeLocationId}
              title={
                trip.stage === "dropoff"
                  ? t("driver.map.trip.dropoffDetails", "Client dropoff details")
                  : t("driver.map.trip.pickupDetails", "Client pickup details")
              }
              onViewOnMap={focusLocationPin}
            />
          </View>
        ) : null}

        {trip ? (
          <DriverNavigationBottomBar
            etaMinutes={routeState.remainingMinutes}
            remainingMeters={routeState.remainingMeters}
            destinationLabel={destinationAddress}
            gpsStatus={location.gpsStatus}
            speedMps={location.speedMps}
            onOpenDetails={openOrderDetails}
          />
        ) : null}

        <DriverReportButton
          driverId={driverId}
          latitude={location.point?.latitude ?? null}
          longitude={location.point?.longitude ?? null}
          orderId={trip?.orderId ?? null}
          sourceTable={(trip?.sourceTable ?? null) as DriverMapReportSourceTable | null}
          moduleType={DEFAULT_DRIVER_MAP_REPORT_CONTEXT.moduleType}
          countryCode={reportCountry.countryCode}
          nearbyCount={nearbyReports.count}
          bottomOffset={showArrivalBanner ? 250 : 158}
          onSubmitted={() => void nearbyReports.refresh()}
        />
      </View>
    </SafeAreaView>
  );
}
