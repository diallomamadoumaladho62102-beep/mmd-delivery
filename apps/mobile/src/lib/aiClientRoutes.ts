/**
 * Routes MMD AI is allowed to open. Keep in sync with web aiActionSanitize.ts.
 */
const IMPLEMENTED = new Set([
  "ClientOrderDetails",
  "ClientChat",
  "ClientDeliveryRequestDetails",
  "ClientInbox",
  "ClientRestaurantList",
  "TaxiHome",
  "TaxiRideTracking",
  "ClientRestaurantMenu",
  "DeliveryRequest",
]);

const ALIASES: Record<string, string> = {
  taxihome: "TaxiHome",
  taxi: "TaxiHome",
  taxiapp: "TaxiHome",
  opentaxi: "TaxiHome",
  taxi_home: "TaxiHome",
  taxiscreen: "TaxiHome",
  clientrestaurantlist: "ClientRestaurantList",
  restaurants: "ClientRestaurantList",
  restaurantlist: "ClientRestaurantList",
  food: "ClientRestaurantList",
  deliveryrequest: "DeliveryRequest",
  package: "DeliveryRequest",
  sendpackage: "DeliveryRequest",
  clientinbox: "ClientInbox",
  support: "ClientInbox",
  contactsupport: "ClientInbox",
  clientorderdetails: "ClientOrderDetails",
  orderdetails: "ClientOrderDetails",
  clientchat: "ClientChat",
  chat: "ClientChat",
  clientdeliveryrequestdetails: "ClientDeliveryRequestDetails",
  taxiridetracking: "TaxiRideTracking",
  clientrestaurantmenu: "ClientRestaurantMenu",
  restaurantmenu: "ClientRestaurantMenu",
};

function foldRouteKey(route: string): string {
  return route.toLowerCase().replace(/[\s_\-/#]+/g, "");
}

function isDangerousClientHref(href: string): boolean {
  const normalized = String(href ?? "").trim().toLowerCase();
  return (
    normalized.startsWith("javascript:") ||
    normalized.startsWith("data:") ||
    normalized.startsWith("vbscript:") ||
    normalized.startsWith("file:")
  );
}

export function canonicalizeClientAiRoute(route: string): string | null {
  const trimmed = String(route ?? "").trim();
  if (!trimmed || trimmed === "#" || isDangerousClientHref(trimmed)) return null;
  if (IMPLEMENTED.has(trimmed)) return trimmed;
  return ALIASES[foldRouteKey(trimmed)] ?? null;
}
