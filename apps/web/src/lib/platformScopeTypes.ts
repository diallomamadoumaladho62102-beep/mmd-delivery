import type { PlatformLaunchStatus } from "@/lib/platformLaunchControl";

export type PlatformScopeLevel = "country" | "region" | "zone";

export type PlatformScopeSource =
  | "order_pickup"
  | "saved_address"
  | "gps"
  | "restaurant_address"
  | "seller_address"
  | "mission"
  | "manual"
  | "profile"
  | "country_fallback";

export type PlatformScopeKey = {
  country_code: string;
  region_code: string | null;
  state_code: string | null;
  mmd_zone_id: string | null;
  zone_code: string | null;
  scope_level: PlatformScopeLevel;
  scope_source: PlatformScopeSource;
};

export type PlatformToggleConfig = {
  country_code: string;
  region_code: string | null;
  scope_level: PlatformScopeLevel;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  maintenance_mode: boolean;
  launch_status: PlatformLaunchStatus;
};

export type PlatformFeatureAvailability = {
  country_code: string;
  region_code: string | null;
  state_code: string | null;
  mmd_zone_id: string | null;
  zone_code: string | null;
  scope_level: PlatformScopeLevel;
  scope_source: PlatformScopeSource;
  scope_label: string;
  platform_enabled: boolean;
  maintenance_mode: boolean;
  taxi_available: boolean;
  delivery_available: boolean;
  restaurant_available: boolean;
  marketplace_available: boolean;
  seller_available: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  message: string | null;
  coming_soon_services: string[];
  can_go_online?: boolean;
  can_accept_orders?: boolean;
  refresh_after_ms: number;
};

export type PlatformRegionRow = {
  id: string;
  country_code: string;
  region_code: string;
  region_name: string;
  region_type: string;
  mmd_zone_id: string | null;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  maintenance_mode: boolean;
  launch_status: PlatformLaunchStatus;
};
