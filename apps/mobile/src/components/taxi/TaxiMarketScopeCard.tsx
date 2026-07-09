import React from "react";
import MarketScopeCard from "../market/MarketScopeCard";
import type { TaxiMarketScope } from "../../lib/taxiMarketScope";

type Props = {
  market: TaxiMarketScope;
  areaLabel: string;
  currencyLabel: string;
  loading?: boolean;
};

export default function TaxiMarketScopeCard({
  market,
  areaLabel,
  currencyLabel,
  loading,
}: Props) {
  return (
    <MarketScopeCard
      market={{
        ...market,
        regionCode: null,
        countyCode: null,
        scopeSource: null,
        deliveryAvailable: false,
        restaurantAvailable: false,
        marketplaceAvailable: false,
        aiAssistantAvailable: false,
      }}
      areaLabel={areaLabel}
      currencyLabel={currencyLabel}
      loading={loading}
      unresolvedMessage="Resolving your market…"
    />
  );
}
