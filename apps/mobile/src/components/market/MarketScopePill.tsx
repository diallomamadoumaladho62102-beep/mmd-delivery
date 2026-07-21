import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { UnifiedMarketScope } from "../../lib/marketScope";

type Props = {
  market: UnifiedMarketScope;
  /** Light pills match the Driver Home mockup header. */
  variant?: "dark" | "light";
};

export default function MarketScopePill({ market, variant = "dark" }: Props) {
  if (!market.scopeResolved) return null;

  const light = variant === "light";

  return (
    <View
      style={{
        alignSelf: light ? "stretch" : "flex-start",
        paddingHorizontal: light ? 12 : 10,
        paddingVertical: light ? 0 : 6,
        borderRadius: 999,
        backgroundColor: light ? "#FFFFFF" : "rgba(15,23,42,0.88)",
        borderWidth: 1,
        borderColor: light ? "#E5E7EB" : "rgba(148,163,184,0.35)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        minHeight: light ? 32 : undefined,
        gap: 4,
        shadowColor: light ? "#0F172A" : undefined,
        shadowOpacity: light ? 0.05 : undefined,
        shadowRadius: light ? 4 : undefined,
        shadowOffset: light ? { width: 0, height: 1 } : undefined,
        elevation: light ? 1 : undefined,
      }}
    >
      {light ? <Ionicons name="location" size={14} color="#16A34A" /> : null}
      <Text
        style={{
          color: light ? "#0F172A" : "#E2E8F0",
          fontSize: light ? 12 : 11,
          fontWeight: "800",
          flexShrink: 1,
        }}
        numberOfLines={1}
      >
        {market.displayLabel}
      </Text>
      {light ? <Ionicons name="chevron-down" size={12} color="#9CA3AF" /> : null}
    </View>
  );
}
