export type MarketplaceDeliveryMissionType = "marketplace_delivery";

export type MarketplaceDeliveryMission = {
  missionType: MarketplaceDeliveryMissionType;
  sellerOrderId: string;
  pickupAddress: string;
  dropoffAddress: string;
  driverEarningEstimateCents: number;
  estimatedDistanceMiles?: number | null;
  estimatedMinutes?: number | null;
};

/** Driver app must not surface marketplace missions until live dispatch is enabled. */
export function isMarketplaceDispatchLiveEnabledForDriver(): boolean {
  return process.env.EXPO_PUBLIC_MARKETPLACE_DISPATCH_LIVE_ENABLED === "true";
}

export function shouldShowMarketplaceDeliveryMission(
  mission: Pick<MarketplaceDeliveryMission, "missionType">
): boolean {
  if (mission.missionType !== "marketplace_delivery") return true;
  return isMarketplaceDispatchLiveEnabledForDriver();
}
