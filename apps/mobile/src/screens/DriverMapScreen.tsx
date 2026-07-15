import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { SafeAreaView, View, StatusBar, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  getMapStyleStreets,
  isMapboxConfigured,
} from "../lib/mapboxConfig";
import {
  buildNavigationInstruction,
  formatNavigationDistance,
  type NavigationInstruction,
} from "../lib/navigationInstructions";
import {
  fitCameraToRoute,
} from "../lib/navigationService";
import {
  buildManeuverList,
  formatManeuverVoice,
  selectActiveManeuver,
} from "../lib/navigationManeuvers";
import {
  evaluateManeuverVoice,
  initVoiceTriggerState,
} from "../lib/navigationVoiceTriggers";
import {
  computeSafetyAnnouncements,
  initSafetyVoiceState,
  projectSafetyEventsOntoRoute,
} from "../lib/roadSafety";
import { isCategoryEnabled } from "../lib/roadSafetyConfig";
import {
  enqueueVoice,
  initVoiceQueue,
  pruneVoiceQueue,
  takeNextVoice,
} from "../lib/navigationVoiceQueue";
import { resolveOverlayInsets } from "../lib/navigationSafeArea";
import {
  resolveNavigationVoiceLanguage,
  speakArrival,
  speakNavigation,
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
import { useRoadSafetyEvents } from "../hooks/useRoadSafetyEvents";
import { DriverNavigationHud } from "../components/driver/DriverNavigationHud";
import { DriverNavigationBottomBar } from "../components/driver/DriverNavigationBottomBar";
import { DriverNavigationControls } from "../components/driver/DriverNavigationControls";
import { DriverNavigationThenToast } from "../components/driver/DriverNavigationThenToast";
import { DriverArrivalBanner } from "../components/driver/DriverArrivalBanner";
import {
  DriverNavigationStatusBanner,
  previewStatusBannerFromQa,
  resolveNavigationStatusBanner,
} from "../components/driver/DriverNavigationStatusBanner";
import { DriverNavigationRouteLayers } from "../components/driver/DriverNavigationRouteLayers";
import { DriverNavigationStreetBubbleLabel } from "../components/driver/DriverNavigationStreetBubble";
import { DriverNavigationAlertPill } from "../components/driver/DriverNavigationAlertPill";
import { DriverNavigationSafetyPanel } from "../components/driver/DriverNavigationSafetyPanel";
import { DriverNavigationSafetyMarkers } from "../components/driver/DriverNavigationSafetyMarkers";
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
  parsePreviewQaParamsFromUrl,
  type PreviewQaParams,
  readEnvPreviewProgress,
} from "../lib/driverNavigationPreview";
import { resolveRouteSpeedLimitState } from "../lib/navigationSpeedLimit";
import { NAV_CAMERA, NAV_ROUTE_ICON_LEAD_METERS } from "../lib/driverNavigationVisual";
import { pointAtRouteDistance } from "../lib/driverNavigationRouteStyle";
import { resolveNavigationLocale } from "../lib/navigationLocale";
import { upsertDriverLiveLocation } from "../lib/driverLocationTracker";

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
  const navRoute = useRoute<RouteProp<RootStackParamList, "DriverMap">>();
  const { t, i18n } = useTranslation();
  const safeAreaInsets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const navScheme = colorScheme === "dark" ? "night" : "day";
  const overlayInsets = useMemo(
    () =>
      resolveOverlayInsets({
        top: safeAreaInsets.top,
        bottom: safeAreaInsets.bottom,
        left: safeAreaInsets.left,
        right: safeAreaInsets.right,
      }),
    [safeAreaInsets.top, safeAreaInsets.bottom, safeAreaInsets.left, safeAreaInsets.right],
  );

  useKeepAwake();

  const routeParams = (navRoute.params ?? {}) as DriverMapRouteParams;
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
  const navLocale = useMemo(
    () => resolveNavigationLocale(i18n.language),
    [i18n.language],
  );
  const [urlPreviewProgress, setUrlPreviewProgress] = useState<number | null>(
    null,
  );
  const [previewQa, setPreviewQa] = useState<PreviewQaParams>({
    progress: null,
    paused: false,
    arrival: false,
    status: null,
    speeding: false,
  });

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
      const qa = parsePreviewQaParamsFromUrl(url);
      setPreviewQa(qa);
      if (qa.progress != null) {
        setUrlPreviewProgress(qa.progress);
      }
      setNavigationPaused(qa.paused);
    };

    void Linking.getInitialURL().then(applyUrl).catch(() => {});
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
  const voiceTriggerStateRef = useRef(initVoiceTriggerState());
  const safetyVoiceStateRef = useRef(initSafetyVoiceState());
  const voiceQueueRef = useRef(initVoiceQueue());
  const tripSessionRef = useRef<TripHistorySession | null>(null);

  const [trip, setTrip] = useState<NavigationTrip | null>(null);
  const [orderLoading, setOrderLoading] = useState(true);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [navigationPaused, setNavigationPaused] = useState(false);
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

  const liveLocation = useDriverMapLocation(
    mapboxReady && !!trip && !previewMode && !navigationPaused,
  );

  const routeState = useDriverNavigationRoute({
    enabled:
      mapboxReady &&
      !!trip &&
      !!activeDestination &&
      (!!liveLocation.point || previewMode),
    allowReroute: !navigationPaused && !previewMode,
    driverPoint: liveLocation.point ?? trip?.pickup ?? null,
    destination: activeDestination,
    stage: trip?.stage ?? "pickup",
    language: navLocale,
    alternatives: true,
    onNetworkFailure: network.reportFailure,
    onNetworkSuccess: network.reportSuccess,
    onReroute: handleReroute,
  });

  const {
    route: navigationRoute,
    routes,
    selectedRouteIndex,
    selectRouteIndex,
    status: routeStatus,
    remainingMeters,
    remainingMinutes,
    refreshRoute,
  } = routeState;

  const previewLocation = useDriverNavigationPreviewLocation(
    mapboxReady && !!trip && previewMode,
    navigationRoute?.geometry,
    fixedPreviewProgress,
  );
  const location = previewMode ? previewLocation : liveLocation;

  const lastTraveledMetersRef = useRef(0);
  const routeGeometryKeyRef = useRef<string | null>(null);

  const activeRouteGeometry = navigationRoute?.geometry ?? null;

  const routeProgress = useMemo(() => {
    if (!location.point || !activeRouteGeometry) return null;

    const coordsLength = activeRouteGeometry.geometry?.coordinates?.length ?? 0;
    if (coordsLength < 2) return null;

    const geometryKey = String(coordsLength);
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

  /** GPS snapé sur la LineString Mapbox — caméra / guidage / progression. */
  const navigationPoint = routeProgress?.anchorPoint ?? location.point ?? null;

  /** Ancre visuelle flèche = split route (aligné vert/cyan sous la base). */
  const vehicleMarkerPoint = useMemo(() => {
    if (!navigationPoint || !activeRouteGeometry || !routeProgress) {
      return navigationPoint;
    }
    if (NAV_ROUTE_ICON_LEAD_METERS <= 0) return navigationPoint;
    const located = pointAtRouteDistance(
      activeRouteGeometry,
      routeProgress.traveledMeters + NAV_ROUTE_ICON_LEAD_METERS,
    );
    return located?.point ?? navigationPoint;
  }, [
    activeRouteGeometry,
    navigationPoint,
    routeProgress,
  ]);

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
    routeProgress?.remainingMeters ?? remainingMeters;

  /** Stable route identity — changes on reroute / alternative selection. */
  const routeVersion = useMemo(() => {
    if (!activeRouteGeometry) return "";
    return `${selectedRouteIndex}:${activeRouteGeometry.geometry?.coordinates?.length ?? 0}`;
  }, [activeRouteGeometry, selectedRouteIndex]);

  /** Ordered maneuvers with cumulative along-route distances. */
  const maneuvers = useMemo(
    () => buildManeuverList(navigationRoute?.steps, routeVersion),
    [navigationRoute?.steps, routeVersion],
  );

  /**
   * Active maneuver selected from live traveled distance — the single source of
   * truth shared by the HUD and the voice engine (visuel = vocal).
   */
  const maneuverSelection = useMemo(() => {
    if (!maneuvers.length || !routeProgress) return null;
    return selectActiveManeuver(maneuvers, routeProgress.traveledMeters);
  }, [maneuvers, routeProgress]);

  const instruction = useMemo<NavigationInstruction | null>(() => {
    if (!trip || !navigationRoute) return null;

    if (maneuverSelection) {
      const { active, distanceMeters, secondary, secondaryDistanceMeters } =
        maneuverSelection;
      return {
        title: active.rawInstruction,
        subtitle: formatNavigationDistance(displayRemainingMeters, navLocale),
        maneuverDistanceMeters: distanceMeters,
        distanceMeters: displayRemainingMeters,
        voiceText: formatManeuverVoice({
          maneuver: active,
          distanceMeters: null,
          locale: navLocale,
        }),
        maneuverType: active.kind,
        secondaryTitle: secondary?.rawInstruction,
        secondaryManeuverType: secondary?.kind,
        secondaryDistanceMeters: secondaryDistanceMeters ?? undefined,
      };
    }

    return buildNavigationInstruction({
      remainingMeters: displayRemainingMeters,
      stage: trip.stage,
      steps: navigationRoute.steps,
      locale: navLocale,
    });
  }, [displayRemainingMeters, maneuverSelection, navLocale, navigationRoute, trip]);

  const camera = useDriverNavigationCamera({
    cameraRef,
    driverPoint: navigationPoint,
    heading: location.heading,
    routeBearing: routeProgress?.forwardBearing ?? vehicleBearing,
    maneuverDistanceMeters: instruction?.maneuverDistanceMeters ?? null,
    speedMps: location.speedMps,
    navigationActive,
    enabled: mapboxReady && !!navigationPoint && !navigationPaused,
  });

  /**
   * Real road-safety data from the Supabase `road-safety-events` Edge Function
   * (curated + OpenStreetMap/Overpass aggregation, ODbL). No provider secret
   * keys ever ship in the app; the backend applies per-country legal gating and
   * returns the runtime config used below. Cached with fallback; refetched on
   * reroute (bbox tile change).
   */
  const roadSafety = useRoadSafetyEvents({
    enabled: navigationActive && !!trip && !navigationPaused,
    routeGeometry: activeRouteGeometry,
    countryCode: trip?.orderCountryCode ?? null,
  });

  /** Client-side defense in depth: honor per-country enable flags + confidence. */
  const enabledSafetyEvents = useMemo(
    () =>
      roadSafety.events.filter(
        (event) =>
          isCategoryEnabled(roadSafety.config, event.type) &&
          (event.confidence ?? 0) >= roadSafety.config.minConfidence,
      ),
    [roadSafety.events, roadSafety.config],
  );

  /** Only events genuinely ahead on the active route (never parallel/behind). */
  const projectedSafetyEvents = useMemo(() => {
    if (!activeRouteGeometry || !routeProgress) return [];
    return projectSafetyEventsOntoRoute({
      events: enabledSafetyEvents,
      geometry: activeRouteGeometry,
      traveledMeters: routeProgress.traveledMeters,
      maxLateralMeters: roadSafety.config.corridorRadiusMeters,
    });
  }, [
    activeRouteGeometry,
    routeProgress,
    enabledSafetyEvents,
    roadSafety.config.corridorRadiusMeters,
  ]);

  /** Nearest ahead event drives the contextual premium panel. */
  const nearestSafetyEvent = useMemo(
    () => (projectedSafetyEvents.length ? projectedSafetyEvents[0] : null),
    [projectedSafetyEvents],
  );

  const navigationAlert = useDriverNavigationAlert({
    enabled: navigationActive && !!trip && !navigationPaused,
    point: navigationPoint,
    countryCode: trip?.orderCountryCode,
    moduleType:
      trip?.sourceTable === "taxi_rides" ? "taxi" : "delivery",
  });

  const displayRemainingMinutes = useMemo(() => {
    if (!navigationRoute) return remainingMinutes;
    return estimateRemainingMinutes(
      displayRemainingMeters,
      navigationRoute.durationSeconds,
      navigationRoute.distanceMeters,
    );
  }, [
    displayRemainingMeters,
    remainingMinutes,
    navigationRoute,
  ]);

  const previewSpeedMps = useMemo(() => {
    if (!previewMode || !previewQa.speeding) {
      return location.speedMps;
    }
    const limit = resolveRouteSpeedLimitState({
      segments: navigationRoute?.speedLimitSegments ?? [],
      traveledMeters: routeProgress?.traveledMeters ?? 0,
      speedMps: location.speedMps,
    }).speedLimitKmh;
    if (limit != null && limit > 0) {
      return (limit + 14) / 3.6;
    }
    return location.speedMps;
  }, [
    location.speedMps,
    navigationRoute,
    previewMode,
    previewQa.speeding,
    routeProgress?.traveledMeters,
  ]);

  const speedLimitState = useMemo(() => {
    if (!navigationRoute) {
      return {
        speedLimitKmh: null,
        postedSpeed: null,
        postedUnit: null,
        isSpeeding: false,
      };
    }
    return resolveRouteSpeedLimitState({
      segments: navigationRoute.speedLimitSegments,
      traveledMeters: routeProgress?.traveledMeters ?? 0,
      speedMps: previewSpeedMps,
    });
  }, [
    navigationRoute,
    previewSpeedMps,
    routeProgress?.traveledMeters,
  ]);

  const arrival = useArrivalGeofence({
    enabled: !!trip && !!location.point && !previewMode && !navigationPaused,
    driverPoint: location.point,
    stage: trip?.stage ?? "pickup",
    pickup: trip?.pickup ?? null,
    dropoff: trip?.dropoff ?? null,
  });

  const destinationArrived = useMemo(() => {
    if (previewMode && previewQa.arrival) return true;
    if (!trip || navigationPaused) return false;
    return trip.stage === "pickup" ? arrival.pickupArrived : arrival.dropoffArrived;
  }, [
    arrival.dropoffArrived,
    arrival.pickupArrived,
    navigationPaused,
    previewMode,
    previewQa.arrival,
    trip,
  ]);

  const statusBanner = useMemo(() => {
    if (previewMode && previewQa.status) {
      return previewStatusBannerFromQa(previewQa.status);
    }

    return resolveNavigationStatusBanner({
      navigationPaused,
      gpsStatus: location.gpsStatus,
      routeStatus: routeStatus,
      networkQuality: network.quality,
    });
  }, [
    location.gpsStatus,
    navigationPaused,
    network.quality,
    previewMode,
    previewQa.status,
    routeStatus,
  ]);

  const controlsTopOffset = Math.max(
    96,
    Math.round(camera.screenLayout.cameraPaddingTop - 28),
    overlayInsets.controlsTop,
  );

  const handleToggleVoice = useCallback(() => {
    setVoiceEnabled((enabled) => {
      if (enabled) {
        void stopNavigationVoice();
      }
      return !enabled;
    });
  }, []);

  const handleRecenter = useCallback(() => {
    camera.setFollowMode();
    camera.recenter();
  }, [camera]);

  const handleRouteOverview = useCallback(() => {
    if (!activeRouteGeometry) return;
    camera.setFreeMode();
    void fitCameraToRoute(cameraRef, activeRouteGeometry);
  }, [activeRouteGeometry, camera]);

  const handleOpenOrderDetails = useCallback(() => {
    if (!trip) return;
    navigation.navigate("DriverOrderDetails", {
      orderId: trip.orderId,
      sourceTable: trip.sourceTable,
    });
  }, [navigation, trip]);

  const handleTogglePause = useCallback(() => {
    setNavigationPaused((paused) => {
      if (!paused) {
        void stopNavigationVoice();
      }
      return !paused;
    });
  }, []);

  const handleResumeNavigation = useCallback(() => {
    setNavigationPaused(false);
    camera.setFollowMode();
    camera.recenter();
  }, [camera]);

  const handleStopNavigation = useCallback(() => {
    void stopNavigationVoice();
    const session = tripSessionRef.current;
    if (session) {
      void appendDriverTripHistory(finalizeTripHistorySession(session)).then(() => {
        void tripHistory.refresh();
      });
      tripSessionRef.current = null;
    }
    navigation.goBack();
  }, [navigation, tripHistory]);

  const handleSelectRouteIndex = useCallback(
    (index: number) => {
      selectRouteIndex(index);
      lastTraveledMetersRef.current = 0;
      routeGeometryKeyRef.current = null;
      camera.setFollowMode();
      camera.recenter();
    },
    [camera, selectRouteIndex],
  );

  const maneuverBubblePoint = useMemo(() => {
    if (!instruction || !navigationPoint || !activeRouteGeometry) return null;

    const maneuverDistance = instruction.maneuverDistanceMeters ?? 0;
    const aheadMeters = Math.min(
      Math.max(maneuverDistance * 0.95, 80),
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
    }).catch(() => {});

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
        }).catch(() => {});
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
    if (previewMode || navigationPaused || !driverId || !location.point) {
      return;
    }

    void upsertDriverLiveLocation(
      driverId,
      location.point.latitude,
      location.point.longitude,
    );
  }, [
    driverId,
    location.point?.latitude,
    location.point?.longitude,
    navigationPaused,
    previewMode,
  ]);

  useEffect(() => {
    if (!location.point || !tripSessionRef.current) return;
    tripSessionRef.current = updateTripHistorySessionPoint(
      tripSessionRef.current,
      location.point,
    );
    if (navigationRoute?.distanceMeters) {
      tripSessionRef.current.routeDistanceMeters = navigationRoute.distanceMeters;
    }
  }, [location.point, navigationRoute?.distanceMeters]);

  useEffect(() => {
    if (!activeRouteGeometry || hasFitRouteRef.current) return;

    hasFitRouteRef.current = true;
    camera.recenter();
  }, [activeRouteGeometry, camera.recenter]);

  // Arrival voice is driven by the real order geofence (pickup/dropoff), which
  // is more reliable than the route-geometry end point.
  useEffect(() => {
    if (!voiceEnabled || navigationPaused || !trip) return;

    if (trip.stage === "pickup" && arrival.pickupArrived && !arrivalVoiceRef.current.pickup) {
      arrivalVoiceRef.current.pickup = true;
      void speakArrival("pickup", voiceLanguage);
    } else if (
      trip.stage === "dropoff" &&
      arrival.dropoffArrived &&
      !arrivalVoiceRef.current.dropoff
    ) {
      arrivalVoiceRef.current.dropoff = true;
      void speakArrival("dropoff", voiceLanguage);
    }
  }, [
    arrival.dropoffArrived,
    arrival.pickupArrived,
    navigationPaused,
    trip,
    voiceEnabled,
    voiceLanguage,
  ]);

  // Distance-threshold voice engine: 500 m / 200 m / immediate announcements
  // for the active maneuver, plus safety alerts, arbitrated by priority so a
  // safety alert never masks an urgent navigation maneuver. No repetition
  // (per-maneuver memory) and automatic reset on reroute (routeVersion).
  useEffect(() => {
    if (!voiceEnabled || navigationPaused || !trip || !navigationActive) return;
    // Final arrival is handled by the geofence effect above.
    if (destinationArrived) return;

    const navResult = evaluateManeuverVoice({
      state: voiceTriggerStateRef.current,
      routeVersion,
      selection: maneuverSelection,
      locale: navLocale,
    });
    voiceTriggerStateRef.current = navResult.state;

    const safetyResult = roadSafety.config.enableVoice
      ? computeSafetyAnnouncements({
          state: safetyVoiceStateRef.current,
          routeVersion,
          events: projectedSafetyEvents,
          locale: navLocale,
          thresholds: {
            far: roadSafety.config.announceFarMeters,
            near: roadSafety.config.announceNearMeters,
          },
        })
      : { state: safetyVoiceStateRef.current, announcement: null };
    safetyVoiceStateRef.current = safetyResult.state;

    const navAnnouncement =
      navResult.announcement && navResult.announcement.bucket !== "arrival"
        ? navResult.announcement
        : null;

    // Robust priority queue: enqueue candidates, cancel obsolete ones (a safety
    // event now behind, or a maneuver already passed), then speak the highest
    // priority once the minimum spacing has elapsed so nothing overlaps.
    const now = Date.now();
    let queue = voiceQueueRef.current;
    queue = enqueueVoice(queue, navAnnouncement, now);
    queue = enqueueVoice(queue, safetyResult.announcement, now);

    const activeIds = new Set<string>();
    if (maneuverSelection) activeIds.add(maneuverSelection.active.id);
    for (const event of projectedSafetyEvents) activeIds.add(`safety:${event.id}`);
    queue = pruneVoiceQueue(queue, now, activeIds);

    const { state: nextQueue, announcement } = takeNextVoice(queue, now);
    voiceQueueRef.current = nextQueue;
    if (announcement) {
      void speakNavigation(announcement.text, true, voiceLanguage);
    }
  }, [
    destinationArrived,
    maneuverSelection,
    navLocale,
    navigationActive,
    navigationPaused,
    projectedSafetyEvents,
    roadSafety.config,
    routeVersion,
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

  if (routeStatus === "error" && !navigationRoute && !previewMode) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
        <DriverMapFallbackStates
          variant="route_error"
          onGoBack={() => navigation.goBack()}
          onRetry={refreshRoute}
        />
      </SafeAreaView>
    );
  }

  const mapStyleURL = getMapStyleStreets();

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      <View style={{ flex: 1 }}>
        {/* MapView aligné sur RestaurantLiveMap : streets-v12 natif, scaleBarEnabled=false uniquement. */}
        <Mapbox.MapView
          ref={mapRef}
          style={{ flex: 1 }}
          styleURL={mapStyleURL}
          scaleBarEnabled={false}
          onTouchStart={camera.setFreeMode}
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

          {vehicleMarkerPoint && navigationActive && (
            <DriverNavigationVehicleMarker
              point={vehicleMarkerPoint}
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

          {navigationActive && projectedSafetyEvents.length > 0 && (
            <DriverNavigationSafetyMarkers
              events={projectedSafetyEvents}
              locale={navLocale}
            />
          )}

        </Mapbox.MapView>

        <DriverNavigationHud visible={!!instruction} instruction={instruction} locale={navLocale} />

        <DriverNavigationStatusBanner
          banner={statusBanner}
          onResume={navigationPaused ? handleResumeNavigation : undefined}
          topOffset={overlayInsets.statusBannerTop}
        />

        {navigationActive && !destinationArrived ? (
          <DriverNavigationSafetyPanel
            event={nearestSafetyEvent}
            locale={navLocale}
            scheme={navScheme}
            topOffset={overlayInsets.statusBannerTop + 44}
          />
        ) : null}

        <DriverNavigationControls
          topOffset={controlsTopOffset}
          voiceEnabled={voiceEnabled}
          navigationPaused={navigationPaused}
          routes={routes}
          selectedRouteIndex={selectedRouteIndex}
          navLocale={navLocale}
          scheme={navScheme}
          onSelectRouteIndex={handleSelectRouteIndex}
          onToggleVoice={handleToggleVoice}
          onRecenter={handleRecenter}
          onRouteOverview={handleRouteOverview}
          onOpenOrderDetails={handleOpenOrderDetails}
          onTogglePause={handleTogglePause}
          onStopNavigation={handleStopNavigation}
        />

        <DriverNavigationAlertPill
          alert={navigationAlert}
          bottomOffset={overlayInsets.alertPillBottom}
        />

        {!destinationArrived ? (
          <DriverNavigationThenToast
            instruction={instruction}
            hasSpeedLimit={speedLimitState.postedSpeed != null}
          />
        ) : null}

        {trip && destinationArrived ? (
          <DriverArrivalBanner
            visible
            stage={trip.stage}
            address={
              trip.stage === "pickup" ? trip.pickupAddress : trip.dropoffAddress
            }
            onOpenOrderDetails={handleOpenOrderDetails}
            bottomOffset={overlayInsets.arrivalBannerBottom}
          />
        ) : null}

        {trip ? (
          <DriverNavigationBottomBar
            etaMinutes={displayRemainingMinutes}
            remainingMeters={displayRemainingMeters}
            speedMps={previewSpeedMps}
            postedSpeed={speedLimitState.postedSpeed}
            isSpeeding={speedLimitState.isSpeeding}
          />
        ) : null}
      </View>
    </View>
  );
}
