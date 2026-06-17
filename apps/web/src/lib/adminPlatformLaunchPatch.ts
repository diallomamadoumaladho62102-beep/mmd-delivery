import type { PlatformLaunchStatus } from "@/lib/platformLaunchControl";
import {
  extractMarketplaceLiveFields,
  sanitizePlatformLaunchMarketplaceFlags,
  type PlatformLaunchPatchInput,
} from "@/lib/marketplaceLaunchControl";

const BOOLEAN_PATCH_KEYS = [
  "platform_enabled",
  "taxi_enabled",
  "delivery_enabled",
  "restaurant_enabled",
  "marketplace_enabled",
  "seller_enabled",
  "checkout_enabled",
  "payout_enabled",
  "maintenance_mode",
  "marketplace_checkout_live_enabled",
  "marketplace_dispatch_live_enabled",
  "marketplace_payouts_live_enabled",
] as const;

export function buildPlatformLaunchPatchUpdate(
  existing: Record<string, unknown>,
  body: Record<string, unknown>
): { ok: true; update: Record<string, unknown> } | { ok: false; error: string } {
  const patchBody: PlatformLaunchPatchInput = {};
  for (const key of BOOLEAN_PATCH_KEYS) {
    if (typeof body[key] === "boolean") {
      patchBody[key] = body[key];
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

  for (const key of BOOLEAN_PATCH_KEYS) {
    if (typeof body[key] === "boolean") {
      update[key] = sanitized.merged[key];
    }
  }

  const launchStatus = String(body.launch_status ?? body.launchStatus ?? "").trim();
  if (
    launchStatus === "enabled" ||
    launchStatus === "disabled" ||
    launchStatus === "maintenance"
  ) {
    update.launch_status = launchStatus as PlatformLaunchStatus;
  }

  if (typeof body.maintenance_mode === "boolean") {
    update.maintenance_mode = sanitized.merged.maintenance_mode;
    if (body.maintenance_mode === true) {
      update.launch_status = "maintenance";
    } else if (existing.launch_status === "maintenance" && body.launch_status == null) {
      update.launch_status = existing.platform_enabled ? "enabled" : "disabled";
    }
  }

  if (body.platform_enabled === false) {
    update.launch_status = "disabled";
  } else if (body.platform_enabled === true && existing.launch_status === "disabled") {
    update.launch_status = "enabled";
    if (typeof body.maintenance_mode !== "boolean" || body.maintenance_mode === false) {
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
