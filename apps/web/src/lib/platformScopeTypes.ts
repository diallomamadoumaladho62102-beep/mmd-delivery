import type { PlatformLaunchStatus } from "@/lib/platformLaunchControl";

export type PlatformScopeLevel = "country" | "region" | "zone" | "county";

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
  county_code: string | null;
  mmd_zone_id: string | null;
  zone_code: string | null;
  scope_level: PlatformScopeLevel;
  scope_source: PlatformScopeSource;
};

export type PlatformToggleConfig = {
  country_code: string;
  region_code: string | null;
  county_code: string | null;
  scope_level: PlatformScopeLevel;
  platform_enabled: boolean;
  taxi_enabled: boolean;
  delivery_enabled: boolean;
  restaurant_enabled: boolean;
  marketplace_enabled: boolean;
  seller_enabled: boolean;
  checkout_enabled: boolean;
  payout_enabled: boolean;
  marketplace_checkout_live_enabled: boolean;
  marketplace_dispatch_live_enabled: boolean;
  marketplace_payouts_live_enabled: boolean;
  maintenance_mode: boolean;
  launch_status: PlatformLaunchStatus;
  ai_enabled: boolean;
};

export type PlatformFeatureAvailability = {
  country_code: string;
  region_code: string | null;
  state_code: string | null;
  county_code: string | null;
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
  marketplace_checkout_live_enabled: boolean;
  marketplace_dispatch_live_enabled: boolean;
  marketplace_payouts_live_enabled: boolean;
  message: string | null;
  coming_soon_services: string[];
  can_go_online?: boolean;
  can_receive_requests?: boolean;
  out_of_service_area?: boolean;
  driver_status_label?: string | null;
  unavailable_title?: string | null;
  can_accept_orders?: boolean;
  ai_assistant_available?: boolean;
  refresh_after_ms: number;
  /** Per-service client denial copy when that vertical is OFF at origin scope. */
  service_messages?: {
    taxi?: string | null;
    delivery?: string | null;
    food?: string | null;
    marketplace?: string | null;
  };
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
  marketplace_checkout_live_enabled: boolean;
  marketplace_dispatch_live_enabled: boolean;
  marketplace_payouts_live_enabled: boolean;
  maintenance_mode: boolean;
  launch_status: PlatformLaunchStatus;
  ai_enabled: boolean;
  ai_enabled_updated_at?: string | null;
  ai_enabled_updated_by?: string | null;
};

export type PlatformCountyRow = {
  id: string;
  country_code: string;
  region_code: string;
  county_code: string;
  county_name: string;
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
