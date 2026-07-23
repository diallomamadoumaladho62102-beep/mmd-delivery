import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";

export type RestaurantHomeNavKey =
  | "home"
  | "dashboard"
  | "orders"
  | "menu"
  | "drivers"
  | "stats"
  | "finance"
  | "tax"
  | "security"
  | "settings"
  | "language"
  | "ai"
  | "heatmap"
  | "dash";

export type RestaurantHomeNavItem = {
  key: RestaurantHomeNavKey;
  icon: ComponentProps<typeof Ionicons>["name"];
  labelKey: string;
  labelFallback: string;
  /** When true, item toggles a map layer instead of navigating. */
  toggle?: "drivers" | "heatmap";
  badge?: "pendingOrders" | "ordersToday" | "drivers";
};

/**
 * Maps every former floating control into structured nav.
 * Only real routes / real actions — no fictitious destinations.
 */
export const RESTAURANT_HOME_NAV: RestaurantHomeNavItem[] = [
  {
    key: "home",
    icon: "home-outline",
    labelKey: "restaurant.home.nav.home",
    labelFallback: "Accueil",
  },
  {
    key: "dashboard",
    icon: "grid-outline",
    labelKey: "restaurant.home.nav.dashboard",
    labelFallback: "Tableau de bord",
  },
  {
    key: "orders",
    icon: "clipboard-outline",
    labelKey: "restaurant.home.nav.orders",
    labelFallback: "Commandes",
    badge: "pendingOrders",
  },
  {
    key: "menu",
    icon: "restaurant-outline",
    labelKey: "restaurant.home.nav.menu",
    labelFallback: "Menu",
  },
  {
    key: "drivers",
    icon: "bicycle-outline",
    labelKey: "restaurant.home.nav.drivers",
    labelFallback: "Livreurs",
    toggle: "drivers",
    badge: "drivers",
  },
  {
    key: "stats",
    icon: "bar-chart-outline",
    labelKey: "restaurant.home.nav.stats",
    labelFallback: "Statistiques",
    badge: "ordersToday",
  },
  {
    key: "finance",
    icon: "briefcase-outline",
    labelKey: "restaurant.home.nav.finance",
    labelFallback: "Finances",
  },
  {
    key: "tax",
    icon: "receipt-outline",
    labelKey: "restaurant.home.nav.tax",
    labelFallback: "Taxes",
  },
  {
    key: "dash",
    icon: "analytics-outline",
    labelKey: "restaurant.home.nav.dash",
    labelFallback: "Aperçu du jour",
  },
  {
    key: "heatmap",
    icon: "flame-outline",
    labelKey: "restaurant.home.nav.heatmap",
    labelFallback: "Heatmap",
    toggle: "heatmap",
  },
  {
    key: "ai",
    icon: "sparkles-outline",
    labelKey: "restaurant.home.nav.ai",
    labelFallback: "MMD AI",
  },
  {
    key: "settings",
    icon: "settings-outline",
    labelKey: "restaurant.home.nav.settings",
    labelFallback: "Paramètres",
  },
  {
    key: "security",
    icon: "lock-closed-outline",
    labelKey: "restaurant.home.nav.security",
    labelFallback: "Sécurité",
  },
  {
    key: "language",
    icon: "globe-outline",
    labelKey: "restaurant.home.nav.language",
    labelFallback: "Langue",
  },
];

/** Map order statuses that actually appear on the restaurant live map. */
export const RESTAURANT_MAP_STATUS_FILTERS = [
  { key: "all", labelKey: "restaurant.home.filter.all", labelFallback: "Tous les statuts" },
  { key: "pending", labelKey: "restaurant.home.filter.pending", labelFallback: "En attente" },
  { key: "accepted", labelKey: "restaurant.home.filter.accepted", labelFallback: "Accepté" },
  { key: "prepared", labelKey: "restaurant.home.filter.prepared", labelFallback: "En préparation" },
  { key: "ready", labelKey: "restaurant.home.filter.ready", labelFallback: "Prêt" },
] as const;

export type RestaurantMapStatusFilter =
  (typeof RESTAURANT_MAP_STATUS_FILTERS)[number]["key"];
