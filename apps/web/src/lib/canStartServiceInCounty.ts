/**
 * Central origin-county service gate.
 *
 * Rule: availability is decided by the ORIGIN (pickup) county.
 * Destination OFF does NOT block starting a trip/order from an active origin.
 */

export type CountyServiceKind =
  | "taxi"
  | "delivery"
  | "food"
  | "marketplace"
  | "platform";

export type CountyServiceToggleSnapshot = {
  county_code: string | null;
  county_name?: string | null;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled?: boolean;
  checkout_enabled?: boolean;
  maintenance_mode?: boolean;
};

export type CanStartServiceInput = {
  service: CountyServiceKind;
  originCounty: CountyServiceToggleSnapshot | null;
  /** Destination is informational only — never blocks start when origin is ON. */
  destinationCounty?: CountyServiceToggleSnapshot | null;
};

export type CountyServiceDenialCode =
  | "origin_county_required"
  | "origin_county_off"
  | "origin_service_off"
  | "origin_maintenance"
  | "allowed";

export type CanStartServiceResult = {
  allowed: boolean;
  code: CountyServiceDenialCode;
  service: CountyServiceKind;
  origin_county_code: string | null;
  destination_county_code: string | null;
  /** Destination OFF is allowed when origin is ON — surfaced for UX/ops. */
  destination_county_off: boolean;
  title: string | null;
  message: string | null;
  actions?: Array<"change_pickup" | "notify_when_available">;
};

const SERVICE_LABEL: Record<CountyServiceKind, string> = {
  taxi: "Taxi service",
  delivery: "Delivery service",
  food: "Food delivery",
  marketplace: "Marketplace",
  platform: "MMD Delivery",
};

function serviceEnabledOnCounty(
  service: CountyServiceKind,
  county: CountyServiceToggleSnapshot
): boolean {
  if (!county.platform_enabled) return false;
  if (county.maintenance_mode) return false;
  switch (service) {
    case "taxi":
      return county.taxi_enabled;
    case "delivery":
      return county.delivery_enabled;
    case "food":
      return county.restaurant_enabled;
    case "marketplace":
      return county.marketplace_enabled;
    case "platform":
      return true;
    default:
      return false;
  }
}

export function clientServiceUnavailableCopy(service: CountyServiceKind): {
  title: string;
  message: string;
  actions: Array<"change_pickup" | "notify_when_available">;
} {
  if (service === "platform") {
    return {
      title: "Service not available yet",
      message:
        "MMD Delivery is not available in your pickup area yet.\nWe are expanding and hope to launch here soon.",
      actions: ["change_pickup", "notify_when_available"],
    };
  }

  const label = SERVICE_LABEL[service];
  return {
    title: "Service not available yet",
    message: `${label} is not available in this county yet.`,
    actions: ["change_pickup", "notify_when_available"],
  };
}

export function driverOutOfServiceAreaCopy(): { title: string; message: string; status: string } {
  return {
    title: "Out of Service Area",
    message:
      "You have entered an area where MMD Delivery is not operating yet.\nYou can finish your current trip, but you will not receive new requests until you return to an active county.",
    status: "Out of Service Area",
  };
}

export function driverWelcomeBackCopy(): { message: string } {
  return {
    message: "Welcome back.\nYou are now available to receive new requests.",
  };
}

export function restaurantFoodDisabledCopy(): { title: string; message: string } {
  return {
    title: "Restaurant Dashboard",
    message:
      "Food delivery is currently disabled in your county.\n\nOrders cannot be received until this county is activated.",
  };
}

export function sellerMarketplaceDisabledCopy(): { message: string } {
  return {
    message:
      "Marketplace disabled in this county.\n\nYour products remain saved, but customers cannot place new orders until Marketplace is activated.",
  };
}

export function adminCountyStatusCopy(county: CountyServiceToggleSnapshot): {
  county_status: "ON" | "OFF";
  county_summary: string;
  services: Array<{ key: string; label: string; status: "Enabled" | "Disabled"; detail: string }>;
} {
  const countyOn = county.platform_enabled && !county.maintenance_mode;
  return {
    county_status: countyOn ? "ON" : "OFF",
    county_summary: countyOn
      ? "County is active. Service availability follows the toggles below."
      : "Services are unavailable for customers, drivers, restaurants and marketplace.",
    services: [
      {
        key: "taxi",
        label: "Taxi",
        status: countyOn && county.taxi_enabled ? "Enabled" : "Disabled",
        detail: "Customers cannot request taxi rides.\nDrivers cannot receive taxi trips.",
      },
      {
        key: "delivery",
        label: "Delivery",
        status: countyOn && county.delivery_enabled ? "Enabled" : "Disabled",
        detail: "Parcel and courier requests are unavailable.",
      },
      {
        key: "food",
        label: "Food",
        status: countyOn && county.restaurant_enabled ? "Enabled" : "Disabled",
        detail: "Restaurants are hidden.\nCustomers cannot order food.",
      },
      {
        key: "marketplace",
        label: "Marketplace",
        status: countyOn && county.marketplace_enabled ? "Enabled" : "Disabled",
        detail: "Stores are hidden.\nCustomers cannot purchase products.",
      },
    ],
  };
}

/**
 * Decide whether a client may START a service based on origin county.
 *
 * Cases:
 * 1. Origin ON + Dest ON  → allow
 * 2. Origin ON + Dest OFF → allow (operate from origin; dest may be expanding)
 * 3. Origin OFF + Dest ON → deny
 * 4. Origin OFF + Dest OFF → deny
 */
export function canStartServiceInCounty(input: CanStartServiceInput): CanStartServiceResult {
  const { service, originCounty, destinationCounty = null } = input;
  const destinationOff = Boolean(
    destinationCounty &&
      (!destinationCounty.platform_enabled || destinationCounty.maintenance_mode)
  );

  if (!originCounty || !originCounty.county_code) {
    const copy = clientServiceUnavailableCopy("platform");
    return {
      allowed: false,
      code: "origin_county_required",
      service,
      origin_county_code: null,
      destination_county_code: destinationCounty?.county_code ?? null,
      destination_county_off: destinationOff,
      title: copy.title,
      message: copy.message,
      actions: copy.actions,
    };
  }

  if (originCounty.maintenance_mode) {
    return {
      allowed: false,
      code: "origin_maintenance",
      service,
      origin_county_code: originCounty.county_code,
      destination_county_code: destinationCounty?.county_code ?? null,
      destination_county_off: destinationOff,
      title: "Service not available yet",
      message: `MMD Delivery is under maintenance in your pickup area.`,
      actions: ["change_pickup", "notify_when_available"],
    };
  }

  if (!originCounty.platform_enabled) {
    const copy = clientServiceUnavailableCopy("platform");
    return {
      allowed: false,
      code: "origin_county_off",
      service,
      origin_county_code: originCounty.county_code,
      destination_county_code: destinationCounty?.county_code ?? null,
      destination_county_off: destinationOff,
      title: copy.title,
      message: copy.message,
      actions: copy.actions,
    };
  }

  if (!serviceEnabledOnCounty(service, originCounty)) {
    const copy = clientServiceUnavailableCopy(service);
    return {
      allowed: false,
      code: "origin_service_off",
      service,
      origin_county_code: originCounty.county_code,
      destination_county_code: destinationCounty?.county_code ?? null,
      destination_county_off: destinationOff,
      title: copy.title,
      message: copy.message,
      actions: copy.actions,
    };
  }

  return {
    allowed: true,
    code: "allowed",
    service,
    origin_county_code: originCounty.county_code,
    destination_county_code: destinationCounty?.county_code ?? null,
    destination_county_off: destinationOff,
    title: null,
    message: null,
  };
}

export function toggleConfigToCountySnapshot(
  config: {
    county_code?: string | null;
    region_code?: string | null;
    platform_enabled: boolean;
    taxi_enabled: boolean;
    delivery_enabled: boolean;
    restaurant_enabled: boolean;
    marketplace_enabled: boolean;
    seller_enabled?: boolean;
    checkout_enabled?: boolean;
    maintenance_mode?: boolean;
  },
  countyName?: string | null
): CountyServiceToggleSnapshot {
  return {
    county_code: config.county_code ?? null,
    county_name: countyName ?? null,
    platform_enabled: config.platform_enabled,
    taxi_enabled: config.taxi_enabled,
    delivery_enabled: config.delivery_enabled,
    restaurant_enabled: config.restaurant_enabled,
    marketplace_enabled: config.marketplace_enabled,
    seller_enabled: config.seller_enabled,
    checkout_enabled: config.checkout_enabled,
    maintenance_mode: config.maintenance_mode,
  };
}

/** Driver may receive NEW requests only while physically in an active county. */
export function canDriverReceiveRequestsInCounty(
  county: CountyServiceToggleSnapshot | null
): {
  can_receive_requests: boolean;
  out_of_service_area: boolean;
  title: string | null;
  message: string | null;
  status: string | null;
} {
  if (!county || !county.county_code || !county.platform_enabled || county.maintenance_mode) {
    const copy = driverOutOfServiceAreaCopy();
    return {
      can_receive_requests: false,
      out_of_service_area: true,
      title: copy.title,
      message: copy.message,
      status: copy.status,
    };
  }

  return {
    can_receive_requests: true,
    out_of_service_area: false,
    title: null,
    message: null,
    status: null,
  };
}
