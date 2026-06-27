import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SafeAreaView, View, StatusBar } from "react-native";
import * as Linking from "expo-linking";
import Mapbox from "@rnmapbox/maps";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { useTranslation } from "react-i18next";
import { useKeepAwake } from "expo-keep-awake";
import { supabase } from "../lib/supabase";
import {
  ensureMapboxTokenApplied,
  getMapStyleNavigation,
  isMapboxConfigured,
} from "../lib/mapboxConfig";
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
import { useDriverNavigationPreviewLocation } from "../hooks/useDriverNavigationPreviewLocation";
import { useDriverNavigationRoute } from "../hooks/useDriverNavigationRoute";
import { useDriverNavigationCamera } from "../hooks/useDriverNavigationCamera";
import { useArrivalGeofence } from "../hooks/useArrivalGeofence";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useDriverNavigationAlert } from "../hooks/useDriverNavigationAlert";
import { DriverNavigationHud } from "../components/driver/DriverNavigationHud";
import { DriverNavigationBottomBar } from "../components/driver/DriverNavigationBottomBar";
import { DriverNavigationRouteLayers } from "../components/driver/DriverNavigationRouteLayers";
import { DriverNavigationStreetBubbleLabel } from "../components/driver/DriverNavigationStreetBubble";
import { DriverNavigationAlertPill } from "../components/driver/DriverNavigationAlertPill";
import { DriverNavigationVehicleMarker } from "../components/driver/DriverNavigationVehicleMarker";
import { DriverMapFallbackStates } from "../components/driver/DriverMapFallbackStates";
import { useDriverTripHistory } from "../hooks/useDriverTripHistory";
import {
  estimateRemainingMinutes,
  getMonotonicRouteProgress,
  getRoutePointAhead,
  resolveDriverNavigationBearing,
} from "../lib/navigationProgress";
import {
  countryCodeFromMarketplaceNavRow,
  coordsFromLocationJoin,
  MARKETPLACE_DELIVERY_JOB_NAV_SELECT,
  marketplaceDriverPayoutDollars,
} from "../lib/marketplaceDriverNavigation";
import { extractCountryCodeField } from "../lib/driverNavigation/reports/resolveCountryCode";
import {
  DRIVER_NAV_PREVIEW_TRIP,
  isDriverNavigationPreviewOrderId,
  parseDriverNavPreviewProgress,
  parsePreviewProgressFromUrl,
  readEnvPreviewProgress,
} from "../lib/driverNavigationPreview";
import { reduceNavigationMapClutter } from "../lib/navigationMapLayers";
import { NAV_CAMERA } from "../lib/driverNavigationVisual";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverMap">;

type DriverMapRouteParams = {
  orderId?: string;
  order_id?: string;
  sourceTable?: OrderSourceTable;
  source_table?: OrderSourceTable;
  destinationStage?: NavigationStage;
  destination_stage?: NavigationStage;
  previewProgress?: number;
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
  const previewMode = isDriverNavigationPreviewOrderId(routeOrderId);
  const navLocale = "fr" as const;
  const [urlPreviewProgress, setUrlPreviewProgress] = useState<number | null>(
    null,
  );

  const fixedPreviewProgress = useMemo(() => {
    return (
      parseDriverNavPreviewProgress(routeParams.previewProgress) ??
      urlPreviewProgress ??
      readEnvPreviewProgress()
    );
  }, [routeParams.previewProgress, urlPreviewProgress]);

  useEffect(() => {
    if (!previewMode) return;

    const applyUrl = (url: string | null | undefined) => {
      const parsed = parsePreviewProgressFromUrl(url);
      if (parsed != null) {
        setUrlPreviewProgress(parsed);
      }
    };

    void Linking.getInitialURL().then(applyUrl);
    const subscription = Linking.addEventListener("url", (event) => {
      applyUrl(event.url);
    });

    return () => subscription.remove();
  }, [previewMode]);

  const mapboxReady = isMapboxConfigured();
  if (mapboxReady) {
    ensureMapboxTokenApplied();
  }

  const cameraRef = useRef<Mapbox.Camera | null>(null);
  const mapRef = useRef<Mapbox.MapView | null>(null);
  const hasFitRouteRef = useRef(false);
  const arrivalVoiceRef = useRef<{ pickup: boolean; dropoff: boolean }>({
    pickup: false,
    dropoff: false,
  });
  const tripSessionRef = useRef<TripHistorySession | null>(null);

  const [trip, setTrip] = useState<NavigationTrip | null>(null);
  const [orderLoading, setOrderLoading] = useState(true);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [driverId, setDriverId] = useState<string | null>(null);

  const network = useNetworkStatus();
  const tripHistory = useDriverTripHistory();

  const activeDestination = useMemo(() => {
    if (!trip) return null;
    return trip.stage === "dropoff" ? trip.dropoff : trip.pickup;
  }, [trip]);

  const voiceLanguage = resolveNavigationVoiceLanguage(i18n.language);

  const handleReroute = useCallback(() => {
    if (!voiceEnabled) return;
    void speakReroute(voiceLanguage);
  }, [voiceEnabled, voiceLanguage]);

  const liveLocation = useDriverMapLocation(mapboxReady && !!trip && !previewMode);

  const routeState = useDriverNavigationRoute({
    enabled:
      mapboxReady &&
      !!trip &&
      !!activeDestination &&
      (!!liveLocation.point || previewMode),
    driverPoint: liveLocation.point ?? trip?.pickup ?? null,
    destination: activeDestination,
    stage: trip?.stage ?? "pickup",
    language: navLocale,
    alternatives: false,
    onNetworkFailure: network.reportFailure,
    onNetworkSuccess: network.reportSuccess,
    onReroute: handleReroute,
  });

  const previewLocation = useDriverNavigationPreviewLocation(
    mapboxReady && !!trip && previewMode,
    routeState.route?.geometry,
    fixedPreviewProgress,
  );
  const location = previewMode ? previewLocation : liveLocation;

  const lastTraveledMetersRef = useRef(0);
  const routeGeometryKeyRef = useRef<string | null>(null);

  const activeRouteGeometry = routeState.route?.geometry ?? null;

  const routeProgress = useMemo(() => {
    if (!location.point || !activeRouteGeometry) return null;

    const geometryKey = String(activeRouteGeometry.geometry.coordinates.length);
    if (routeGeometryKeyRef.current !== geometryKey) {
      routeGeometryKeyRef.current = geometryKey;
      lastTraveledMetersRef.current = 0;
    }

    const progress = getMonotonicRouteProgress(
      location.point,
      activeRouteGeometry,
      lastTraveledMetersRef.current,
    );
    if (progress) {
      lastTraveledMetersRef.current = progress.traveledMeters;
    }
    return progress;
  }, [activeRouteGeometry, location.point]);

  /** GPS snapé sur la LineString Mapbox — unique ancrage véhicule / routes / caméra. */
  const navigationPoint = routeProgress?.anchorPoint ?? location.point ?? null;

  const vehicleBearing = useMemo(() => {
    if (!navigationPoint || !routeProgress) return location.heading;
    return resolveDriverNavigationBearing({
      gpsHeading: location.heading,
      routeForwardBearing: routeProgress.forwardBearing,
      route: activeRouteGeometry,
      anchor: navigationPoint,
      closestIndex: routeProgress.closestIndex,
    });
  }, [
    activeRouteGeometry,
    location.heading,
    navigationPoint,
    routeProgress,
  ]);

  const navigationActive = Boolean(activeRouteGeometry);

  const displayRemainingMeters =
    routeProgress?.remainingMeters ?? routeState.remainingMeters;

  const instruction = useMemo(() => {
    if (!trip || !routeState.route) return null;

    return buildNavigationInstruction({
      remainingMeters: displayRemainingMeters,
      stage: trip.stage,
      steps: routeState.route.steps,
      locale: navLocale,
    });
  }, [displayRemainingMeters, navLocale, routeState.route, trip]);

  const camera = useDriverNavigationCamera({
    cameraRef,
    driverPoint: navigationPoint,
    heading: location.heading,
    routeBearing: routeProgress?.forwardBearing ?? vehicleBearing,
    maneuverDistanceMeters: instruction?.maneuverDistanceMeters ?? null,
    speedMps: location.speedMps,
    navigationActive,
    enabled: mapboxReady && !!navigationPoint,
  });

  const navigationAlert = useDriverNavigationAlert({
    enabled: navigationActive && !!trip,
    point: navigationPoint,
    countryCode: trip?.orderCountryCode,
    moduleType:
      trip?.sourceTable === "taxi_rides" ? "taxi" : "delivery",
  });

  const displayRemainingMinutes = useMemo(() => {
    if (!routeState.route) return routeState.remainingMinutes;
    return estimateRemainingMinutes(
      displayRemainingMeters,
      routeState.route.durationSeconds,
      routeState.route.distanceMeters,
    );
  }, [
    displayRemainingMeters,
    routeState.remainingMinutes,
    routeState.route,
  ]);

  const arrival = useArrivalGeofence({
    enabled: !!trip && !!location.point && !previewMode,
    driverPoint: location.point,
    stage: trip?.stage ?? "pickup",
    pickup: trip?.pickup ?? null,
    dropoff: trip?.dropoff ?? null,
  });

  const maneuverBubblePoint = useMemo(() => {
    if (!instruction || !navigationPoint || !activeRouteGeometry) return null;

    const aheadMeters = Math.min(
      Math.max(instruction.maneuverDistanceMeters * 0.95, 80),
      650,
    );

    return getRoutePointAhead(
      activeRouteGeometry,
      navigationPoint,
      aheadMeters,
    );
  }, [
    activeRouteGeometry,
    instruction,
    navigationPoint,
  ]);

  useEffect(() => {
    if (previewMode) return;

    let cancelled = false;

    void supabase.auth.getUser().then(({ data, error }) => {
      if (cancelled || error || !data?.user) return;
      setDriverId(data.user.id);
    });

    return () => {
      cancelled = true;
    };
  }, [previewMode]);

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
    if (previewMode) {
      setOrderError(null);
      setTrip(DRIVER_NAV_PREVIEW_TRIP);
      hasFitRouteRef.current = false;
      arrivalVoiceRef.current = { pickup: false, dropoff: false };
      setOrderLoading(false);
      return;
    }

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
  }, [previewMode, routeOrderId, routeSourceTable, routeStage, t]);

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
    if (!activeRouteGeometry || hasFitRouteRef.current) return;

    hasFitRouteRef.current = true;
    camera.recenter();
  }, [activeRouteGeometry, camera.recenter]);

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

  if (routeState.status === "error" && !routeState.route && !previewMode) {
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

  const mapStyleURL = getMapStyleNavigation();

  return (
    <View style={{ flex: 1, backgroundColor: "#0A0A0A" }}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <View style={{ flex: 1 }}>
        <Mapbox.MapView
          ref={mapRef}
          style={{ flex: 1 }}
          styleURL={mapStyleURL}
          surfaceView={false}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={false}
          onTouchStart={camera.setFreeMode}
          onDidFinishLoadingMap={() => {
            void reduceNavigationMapClutter(mapRef);
            setTimeout(() => void reduceNavigationMapClutter(mapRef), 800);
            setTimeout(() => void reduceNavigationMapClutter(mapRef), 2500);
          }}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{
              centerCoordinate: navigationPoint
                ? [navigationPoint.longitude, navigationPoint.latitude]
                : activeDestination
                  ? [
                      activeDestination.longitude,
                      activeDestination.latitude,
                    ]
                  : undefined,
              zoomLevel: NAV_CAMERA.zoom,
              pitch: NAV_CAMERA.pitch,
              heading: routeProgress?.forwardBearing ?? vehicleBearing,
              padding: navigationActive
                ? {
                    paddingTop: camera.screenLayout.cameraPaddingTop,
                    paddingBottom: camera.screenLayout.cameraPaddingBottom,
                    paddingLeft: camera.screenLayout.cameraPaddingLeft,
                    paddingRight: camera.screenLayout.cameraPaddingRight,
                  }
                : undefined,
            }}
          />

          <Mapbox.UserLocation visible={false} showsUserHeadingIndicator={false} />

          {activeRouteGeometry && routeProgress && (
            <DriverNavigationRouteLayers
              geometry={activeRouteGeometry}
              traveledMeters={routeProgress.traveledMeters}
              layout={camera.screenLayout}
            />
          )}

          {navigationPoint && navigationActive && (
            <DriverNavigationVehicleMarker
              point={navigationPoint}
              bearing={vehicleBearing}
              followMode={camera.mode === "follow"}
            />
          )}

          {maneuverBubblePoint && instruction && navigationActive && (
            <Mapbox.PointAnnotation
              id="driver-navigation-maneuver-bubble"
              coordinate={[
                maneuverBubblePoint.longitude,
                maneuverBubblePoint.latitude,
              ]}
              anchor={{ x: 0.5, y: 1 }}
              selected
            >
              <DriverNavigationStreetBubbleLabel streetName={instruction.title} />
            </Mapbox.PointAnnotation>
          )}

        </Mapbox.MapView>

        <DriverNavigationHud visible={!!instruction} instruction={instruction} />

        <DriverNavigationAlertPill alert={navigationAlert} />

        {trip ? (
          <DriverNavigationBottomBar
            etaMinutes={displayRemainingMinutes}
            remainingMeters={displayRemainingMeters}
            speedMps={location.speedMps}
          />
        ) : null}
      </View>
    </View>
  );
}
