import React from "react";
import { View, Text } from "react-native";
import type { UnifiedMarketScope } from "../../lib/marketScope";

type Props = {
  market: UnifiedMarketScope;
};

export default function MarketScopePill({ market }: Props) {
  if (!market.scopeResolved) return null;

  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 999,
        backgroundColor: "rgba(15,23,42,0.88)",
        borderWidth: 1,
        borderColor: "rgba(148,163,184,0.35)",
      }}
    >
      <Text style={{ color: "#E2E8F0", fontSize: 11, fontWeight: "800" }}>
        {market.displayLabel} · {market.currencyCode}
      </Text>
    </View>
  );
}
