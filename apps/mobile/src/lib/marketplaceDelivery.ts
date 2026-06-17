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

/** Driver visibility for marketplace pool jobs is server/API gated; live payout stays env-gated. */
export function isMarketplaceDispatchLiveEnabledForDriver(): boolean {
  return process.env.EXPO_PUBLIC_MARKETPLACE_DISPATCH_LIVE_ENABLED === "true";
}

export function shouldShowMarketplaceDeliveryMission(
  mission: Pick<MarketplaceDeliveryMission, "missionType">
): boolean {
  return mission.missionType === "marketplace_delivery";
}
