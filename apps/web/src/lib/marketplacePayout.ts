export {
  isMarketplacePayoutsLiveEnvEnabled,
  isMarketplacePayoutsLiveEnabledForConfig,
} from "@/lib/marketplaceLaunchControl";

export function isMarketplacePayoutsLiveEnabled(): boolean {
  return process.env.MARKETPLACE_PAYOUTS_LIVE_ENABLED === "true";
}

export const MARKETPLACE_PAYOUTS_LIVE_DISABLED_MESSAGE =
  "Marketplace live payouts are not enabled yet";

export type MarketplacePayoutStatus =
  | "pending"
  | "approved"
  | "paid"
  | "failed"
  | "cancelled";
