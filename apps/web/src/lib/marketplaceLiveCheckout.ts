export {
  isMarketplaceCheckoutLiveEnvEnabled,
  isMarketplaceCheckoutLiveEnabledForConfig,
} from "@/lib/marketplaceLaunchControl";

export function isMarketplaceCheckoutLiveEnabled(): boolean {
  return process.env.MARKETPLACE_CHECKOUT_LIVE_ENABLED === "true";
}

export const MARKETPLACE_CHECKOUT_LIVE_COMING_SOON =
  "Marketplace live checkout is not enabled yet";
