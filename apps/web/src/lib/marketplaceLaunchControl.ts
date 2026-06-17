import type { PlatformLaunchStatus } from "@/lib/platformLaunchControl";
import type { PlatformToggleConfig } from "@/lib/platformScopeTypes";

export type MarketplaceLiveToggleConfig = Pick<
  PlatformToggleConfig,
  | "platform_enabled"
  | "marketplace_enabled"
  | "seller_enabled"
  | "checkout_enabled"
  | "payout_enabled"
  | "maintenance_mode"
  | "launch_status"
  | "marketplace_checkout_live_enabled"
  | "marketplace_dispatch_live_enabled"
  | "marketplace_payouts_live_enabled"
>;

export type PlatformLaunchPatchInput = Partial<
  Record<
    | "platform_enabled"
    | "taxi_enabled"
    | "delivery_enabled"
    | "restaurant_enabled"
    | "marketplace_enabled"
    | "seller_enabled"
    | "checkout_enabled"
    | "payout_enabled"
    | "maintenance_mode"
    | "marketplace_checkout_live_enabled"
    | "marketplace_dispatch_live_enabled"
    | "marketplace_payouts_live_enabled",
    boolean
  >
>;

export function isMarketplaceCheckoutLiveEnvEnabled(): boolean {
  return process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED === "true";
}

export function isMarketplaceDispatchLiveEnvEnabled(): boolean {
  return process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED === "true";
}

export function isMarketplacePayoutsLiveEnvEnabled(): boolean {
  return process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED === "true";
}

export function isPlatformScopeOperational(config: MarketplaceLiveToggleConfig): boolean {
  if (config.maintenance_mode || config.launch_status === "maintenance") return false;
  return config.platform_enabled;
}

export function isMarketplaceCheckoutLiveEnabledForConfig(
  config: MarketplaceLiveToggleConfig
): boolean {
  return (
    isMarketplaceCheckoutLiveEnvEnabled() &&
    isPlatformScopeOperational(config) &&
    config.marketplace_enabled &&
    config.seller_enabled &&
    config.checkout_enabled &&
    config.marketplace_checkout_live_enabled
  );
}

export function isMarketplaceDispatchLiveEnabledForConfig(
  config: MarketplaceLiveToggleConfig
): boolean {
  return (
    isMarketplaceDispatchLiveEnvEnabled() &&
    isPlatformScopeOperational(config) &&
    config.marketplace_enabled &&
    config.seller_enabled &&
    config.marketplace_dispatch_live_enabled
  );
}

export function isMarketplacePayoutsLiveEnabledForConfig(
  config: MarketplaceLiveToggleConfig
): boolean {
  return (
    isMarketplacePayoutsLiveEnvEnabled() &&
    isPlatformScopeOperational(config) &&
    config.marketplace_enabled &&
    config.seller_enabled &&
    config.payout_enabled &&
    config.marketplace_payouts_live_enabled
  );
}

function mergeLaunchBooleans(
  existing: MarketplaceLiveToggleConfig,
  body: PlatformLaunchPatchInput
): MarketplaceLiveToggleConfig {
  return {
    platform_enabled:
      typeof body.platform_enabled === "boolean"
        ? body.platform_enabled
        : existing.platform_enabled,
    marketplace_enabled:
      typeof body.marketplace_enabled === "boolean"
        ? body.marketplace_enabled
        : existing.marketplace_enabled,
    seller_enabled:
      typeof body.seller_enabled === "boolean" ? body.seller_enabled : existing.seller_enabled,
    checkout_enabled:
      typeof body.checkout_enabled === "boolean"
        ? body.checkout_enabled
        : existing.checkout_enabled,
    payout_enabled:
      typeof body.payout_enabled === "boolean" ? body.payout_enabled : existing.payout_enabled,
    maintenance_mode:
      typeof body.maintenance_mode === "boolean"
        ? body.maintenance_mode
        : existing.maintenance_mode,
    launch_status: existing.launch_status,
    marketplace_checkout_live_enabled:
      typeof body.marketplace_checkout_live_enabled === "boolean"
        ? body.marketplace_checkout_live_enabled
        : existing.marketplace_checkout_live_enabled,
    marketplace_dispatch_live_enabled:
      typeof body.marketplace_dispatch_live_enabled === "boolean"
        ? body.marketplace_dispatch_live_enabled
        : existing.marketplace_dispatch_live_enabled,
    marketplace_payouts_live_enabled:
      typeof body.marketplace_payouts_live_enabled === "boolean"
        ? body.marketplace_payouts_live_enabled
        : existing.marketplace_payouts_live_enabled,
  };
}

export function sanitizePlatformLaunchMarketplaceFlags(
  existing: MarketplaceLiveToggleConfig,
  body: PlatformLaunchPatchInput
): { ok: true; merged: MarketplaceLiveToggleConfig } | { ok: false; error: string } {
  let merged = mergeLaunchBooleans(existing, body);

  if (!merged.platform_enabled || merged.maintenance_mode) {
    merged = {
      ...merged,
      marketplace_enabled: false,
      seller_enabled: false,
      marketplace_checkout_live_enabled: false,
      marketplace_dispatch_live_enabled: false,
      marketplace_payouts_live_enabled: false,
    };
  }

  if (!merged.marketplace_enabled) {
    merged = {
      ...merged,
      seller_enabled: false,
      marketplace_checkout_live_enabled: false,
      marketplace_dispatch_live_enabled: false,
      marketplace_payouts_live_enabled: false,
    };
  }

  if (!merged.seller_enabled) {
    merged = {
      ...merged,
      marketplace_checkout_live_enabled: false,
      marketplace_dispatch_live_enabled: false,
      marketplace_payouts_live_enabled: false,
    };
  }

  if (merged.marketplace_checkout_live_enabled) {
    if (!merged.checkout_enabled) {
      return {
        ok: false,
        error: "marketplace_checkout_live_requires_checkout_enabled",
      };
    }
  }

  if (merged.marketplace_payouts_live_enabled && !merged.payout_enabled) {
    return {
      ok: false,
      error: "marketplace_payouts_live_requires_payout_enabled",
    };
  }

  return { ok: true, merged };
}

export function extractMarketplaceLiveFields(
  row: Record<string, unknown>
): MarketplaceLiveToggleConfig {
  return {
    platform_enabled: Boolean(row.platform_enabled),
    marketplace_enabled: Boolean(row.marketplace_enabled),
    seller_enabled: Boolean(row.seller_enabled),
    checkout_enabled: Boolean(row.checkout_enabled),
    payout_enabled: Boolean(row.payout_enabled),
    maintenance_mode: Boolean(row.maintenance_mode),
    launch_status: String(row.launch_status ?? "disabled") as PlatformLaunchStatus,
    marketplace_checkout_live_enabled: Boolean(row.marketplace_checkout_live_enabled),
    marketplace_dispatch_live_enabled: Boolean(row.marketplace_dispatch_live_enabled),
    marketplace_payouts_live_enabled: Boolean(row.marketplace_payouts_live_enabled),
  };
}

export const MARKETPLACE_LIVE_PATCH_KEYS = [
  "marketplace_checkout_live_enabled",
  "marketplace_dispatch_live_enabled",
  "marketplace_payouts_live_enabled",
] as const;
