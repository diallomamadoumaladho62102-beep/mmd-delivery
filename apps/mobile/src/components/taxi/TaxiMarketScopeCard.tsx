import React from "react";
import { View, Text } from "react-native";
import type { TaxiMarketScope } from "../../lib/taxiMarketScope";
import { getTaxiUiString } from "../../lib/taxiLocalization";

type Props = {
  market: TaxiMarketScope;
  areaLabel: string;
  currencyLabel: string;
};

export default function TaxiMarketScopeCard({ market, areaLabel, currencyLabel }: Props) {
  return (
    <View
      style={{
        gap: 6,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#334155",
        backgroundColor: "rgba(15,23,42,0.95)",
      }}
    >
      <Text style={{ color: "#64748B", fontSize: 12, fontWeight: "600" }}>
        {areaLabel}
      </Text>
      <Text style={{ color: "#F8FAFC", fontSize: 17, fontWeight: "800" }}>
        {market.displayLabel}
      </Text>
      <Text style={{ color: "#94A3B8", fontSize: 13 }}>
        {currencyLabel} · {market.currencyCode}
      </Text>
      <Text style={{ color: "#64748B", fontSize: 12 }}>
        {getTaxiUiString("estimatesIn", market.countryCode)} {market.currencyCode}
      </Text>
    </View>
  );
}
