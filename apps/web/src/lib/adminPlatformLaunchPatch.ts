import type { PlatformLaunchStatus } from "@/lib/platformLaunchControl";
import {
  extractMarketplaceLiveFields,
  sanitizePlatformLaunchMarketplaceFlags,
  type PlatformLaunchPatchInput,
} from "@/lib/marketplaceLaunchControl";

/** Service / ops flags that are not owned by marketplace live sanitization. */
const SERVICE_PATCH_KEYS = [
  "taxi_enabled",
  "delivery_enabled",
  "restaurant_enabled",
  "checkout_enabled",
  "payout_enabled",
] as const;

const MARKETPLACE_OWNED_PATCH_KEYS = [
  "platform_enabled",
  "marketplace_enabled",
  "seller_enabled",
  "maintenance_mode",
  "marketplace_checkout_live_enabled",
  "marketplace_dispatch_live_enabled",
  "marketplace_payouts_live_enabled",
] as const;

const BOOLEAN_PATCH_KEYS = [
  ...SERVICE_PATCH_KEYS,
  ...MARKETPLACE_OWNED_PATCH_KEYS,
] as const;

/**
 * Normalize admin PATCH bodies: accept food_enabled as alias for restaurant_enabled
 * (County Management / docs wording).
 */
export function normalizePlatformLaunchPatchBody(
  body: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...body };
  if (typeof next.food_enabled === "boolean" && typeof next.restaurant_enabled !== "boolean") {
    next.restaurant_enabled = next.food_enabled;
  }
  if (typeof next.county_enabled === "boolean" && typeof next.platform_enabled !== "boolean") {
    next.platform_enabled = next.county_enabled;
  }
  return next;
}

export function buildPlatformLaunchPatchUpdate(
  existing: Record<string, unknown>,
  body: Record<string, unknown>
): { ok: true; update: Record<string, unknown> } | { ok: false; error: string } {
  const normalized = normalizePlatformLaunchPatchBody(body);
  const patchBody: PlatformLaunchPatchInput = {};
  for (const key of BOOLEAN_PATCH_KEYS) {
    if (typeof normalized[key] === "boolean") {
      patchBody[key] = normalized[key] as boolean;
    }
  }

  const sanitized = sanitizePlatformLaunchMarketplaceFlags(
    extractMarketplaceLiveFields(existing),
    patchBody
  );
  if (sanitized.ok === false) {
    return { ok: false, error: sanitized.error };
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  // Service flags come from the request body — marketplace sanitize does not carry them.
  for (const key of SERVICE_PATCH_KEYS) {
    if (typeof normalized[key] === "boolean") {
      update[key] = normalized[key];
    }
  }

  // Marketplace / platform flags come from sanitized merge (cascades + live guards).
  for (const key of MARKETPLACE_OWNED_PATCH_KEYS) {
    if (typeof normalized[key] === "boolean") {
      update[key] = sanitized.merged[key];
    }
  }

  // County OFF must force all commercial services OFF in the persisted row.
  if (normalized.platform_enabled === false || sanitized.merged.platform_enabled === false) {
    update.taxi_enabled = false;
    update.delivery_enabled = false;
    update.restaurant_enabled = false;
    update.marketplace_enabled = false;
    update.seller_enabled = false;
    update.checkout_enabled = false;
    update.payout_enabled = false;
    update.marketplace_checkout_live_enabled = false;
    update.marketplace_dispatch_live_enabled = false;
    update.marketplace_payouts_live_enabled = false;
  }

  const launchStatus = String(normalized.launch_status ?? normalized.launchStatus ?? "").trim();
  if (
    launchStatus === "enabled" ||
    launchStatus === "disabled" ||
    launchStatus === "maintenance"
  ) {
    update.launch_status = launchStatus as PlatformLaunchStatus;
  }

  if (typeof normalized.maintenance_mode === "boolean") {
    update.maintenance_mode = sanitized.merged.maintenance_mode;
    if (normalized.maintenance_mode === true) {
      update.launch_status = "maintenance";
    } else if (existing.launch_status === "maintenance" && normalized.launch_status == null) {
      update.launch_status = existing.platform_enabled ? "enabled" : "disabled";
    }
  }

  if (normalized.platform_enabled === false) {
    update.launch_status = "disabled";
  } else if (normalized.platform_enabled === true && existing.launch_status === "disabled") {
    update.launch_status = "enabled";
    if (
      typeof normalized.maintenance_mode !== "boolean" ||
      normalized.maintenance_mode === false
    ) {
      update.maintenance_mode = false;
    }
  }

  if (sanitized.merged.platform_enabled === false) {
    update.marketplace_enabled = false;
    update.seller_enabled = false;
    update.marketplace_checkout_live_enabled = false;
    update.marketplace_dispatch_live_enabled = false;
    update.marketplace_payouts_live_enabled = false;
  }

  if (sanitized.merged.marketplace_enabled === false) {
    update.seller_enabled = false;
    update.marketplace_checkout_live_enabled = false;
    update.marketplace_dispatch_live_enabled = false;
    update.marketplace_payouts_live_enabled = false;
  }

  if (sanitized.merged.seller_enabled === false) {
    update.marketplace_checkout_live_enabled = false;
    update.marketplace_dispatch_live_enabled = false;
    update.marketplace_payouts_live_enabled = false;
  }

  return { ok: true, update };
}
