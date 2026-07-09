export {
  isMarketplaceCheckoutLiveEnvEnabled,
  isMarketplaceCheckoutLiveEnabledForConfig,
  assertMarketplaceLiveMoneyAllowed,
  isMarketplaceSellerPayoutsE2EReady,
} from "@/lib/marketplaceLaunchControl";
import {
  isMarketplaceCheckoutLiveEnvEnabled,
  isMarketplaceSellerPayoutsE2EReady,
} from "@/lib/marketplaceLaunchControl";

/** Env-only live flag AND seller payouts E2E readiness. */
export function isMarketplaceCheckoutLiveEnabled(): boolean {
  return (
    isMarketplaceSellerPayoutsE2EReady() &&
    isMarketplaceCheckoutLiveEnvEnabled()
  );
}

export const MARKETPLACE_CHECKOUT_LIVE_COMING_SOON =
  "Marketplace live checkout is not enabled yet";
