import type { AiAction, AiNavigateAction } from "@/lib/ai/aiTypes";

/** Routes that MmdAiScreen can actually open today. */
export const IMPLEMENTED_CLIENT_AI_ROUTES = [
  "ClientOrderDetails",
  "ClientChat",
  "ClientDeliveryRequestDetails",
  "ClientInbox",
  "ClientRestaurantList",
  "TaxiHome",
  "TaxiRideTracking",
  "ClientRestaurantMenu",
  "DeliveryRequest",
] as const;

export type ImplementedClientAiRoute = (typeof IMPLEMENTED_CLIENT_AI_ROUTES)[number];

const ROUTE_ALIASES: Record<string, ImplementedClientAiRoute> = {
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

const TAXI_CTA_RE =
  /ouvrir l['’]application de taxi|open taxi( app)?|book a taxi|ouvrir taxi|taxi home/i;

function foldRouteKey(route: string): string {
  return route.toLowerCase().replace(/[\s_\-/#]+/g, "");
}

export function canonicalizeClientAiRoute(route: string): ImplementedClientAiRoute | null {
  const trimmed = String(route ?? "").trim();
  if (!trimmed || trimmed === "#" || trimmed === "javascript:void(0)") return null;
  const implemented = IMPLEMENTED_CLIENT_AI_ROUTES as readonly string[];
  if (implemented.includes(trimmed)) return trimmed as ImplementedClientAiRoute;
  return ROUTE_ALIASES[foldRouteKey(trimmed)] ?? null;
}

export function taxiHomeAction(label = "Open Taxi"): AiNavigateAction {
  return {
    type: "navigate",
    label,
    route: "TaxiHome",
    params: {},
    icon: "taxi",
  };
}

const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]*)\)/g;

export function stripFakeMarkdownLinks(content: string): { text: string; sawTaxiCta: boolean } {
  let sawTaxiCta = false;
  const text = String(content ?? "").replace(MARKDOWN_LINK_RE, (_full, label: string, href: string) => {
    const safeLabel = String(label ?? "").trim();
    const safeHref = String(href ?? "").trim();
    if (TAXI_CTA_RE.test(safeLabel) || TAXI_CTA_RE.test(safeHref)) {
      sawTaxiCta = true;
    }
    if (!safeHref || safeHref === "#" || safeHref.startsWith("javascript:")) {
      return safeLabel;
    }
    if (canonicalizeClientAiRoute(safeHref)) {
      if (TAXI_CTA_RE.test(safeLabel) || canonicalizeClientAiRoute(safeHref) === "TaxiHome") {
        sawTaxiCta = true;
      }
      return safeLabel;
    }
    return safeLabel;
  });
  if (TAXI_CTA_RE.test(text)) sawTaxiCta = true;
  return { text: text.replace(/\n{3,}/g, "\n\n").trim(), sawTaxiCta };
}

export function sanitizeAiActions(actions: AiAction[]): AiAction[] {
  const out: AiAction[] = [];
  for (const action of actions) {
    if (action.type === "quick_reply") {
      out.push(action);
      continue;
    }
    const route = canonicalizeClientAiRoute(action.route);
    if (!route) continue;
    out.push({
      ...action,
      route,
    });
  }
  return out;
}

export function sanitizeAssistantOutput(
  content: string,
  actions: AiAction[]
): { content: string; actions: AiAction[] } {
  const stripped = stripFakeMarkdownLinks(content);
  const nextActions = sanitizeAiActions(actions);
  const hasTaxi = nextActions.some(
    (action) => action.type === "navigate" && canonicalizeClientAiRoute(action.route) === "TaxiHome"
  );
  if (stripped.sawTaxiCta && !hasTaxi) {
    nextActions.push(taxiHomeAction());
  }
  return { content: stripped.text, actions: nextActions };
}
