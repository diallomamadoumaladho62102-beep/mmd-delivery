export {
  isMarketplaceDispatchLiveEnvEnabled,
  isMarketplaceDispatchLiveEnabledForConfig,
} from "@/lib/marketplaceLaunchControl";

export function isMarketplaceDispatchLiveEnabled(): boolean {
  return process.env.MARKETPLACE_DISPATCH_LIVE_ENABLED === "true";
}

export const MARKETPLACE_DISPATCH_LIVE_DISABLED_MESSAGE =
  "Marketplace live dispatch is not enabled yet";

export type MarketplaceDeliveryJobStatus =
  | "dispatch_pending"
  | "dispatch_ready"
  | "dispatch_assigned"
  | "picked_up"
  | "delivered"
  | "cancelled";
