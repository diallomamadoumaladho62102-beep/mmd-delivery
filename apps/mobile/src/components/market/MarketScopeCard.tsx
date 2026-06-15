import React from "react";
import { View, Text, ActivityIndicator } from "react-native";
import type { UnifiedMarketScope } from "../../lib/marketScope";

type Props = {
  market: UnifiedMarketScope;
  areaLabel?: string;
  currencyLabel?: string;
  loading?: boolean;
  unresolvedMessage?: string;
  variant?: "dark" | "light";
};

export default function MarketScopeCard({
  market,
  areaLabel = "Your market",
  currencyLabel = "Currency",
  loading = false,
  unresolvedMessage = "Resolving your market from GPS…",
  variant = "dark",
}: Props) {
  const isDark = variant === "dark";

  if (loading && !market.scopeResolved) {
    return (
      <View
        style={{
          gap: 8,
          padding: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: isDark ? "#334155" : "#E2E8F0",
          backgroundColor: isDark ? "rgba(15,23,42,0.95)" : "#F8FAFC",
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        <ActivityIndicator color={isDark ? "#94A3B8" : "#64748B"} />
        <Text style={{ color: isDark ? "#94A3B8" : "#64748B", fontSize: 13 }}>
          {unresolvedMessage}
        </Text>
      </View>
    );
  }

  if (!market.scopeResolved) {
    return (
      <View
        style={{
          padding: 14,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "#F59E0B",
          backgroundColor: "rgba(245,158,11,0.12)",
        }}
      >
        <Text style={{ color: "#FDE68A", fontSize: 13, fontWeight: "600" }}>
          Market scope unavailable. Enable location or try again.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        gap: 6,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: isDark ? "#334155" : "#E2E8F0",
        backgroundColor: isDark ? "rgba(15,23,42,0.95)" : "#FFFFFF",
      }}
    >
      <Text
        style={{
          color: isDark ? "#64748B" : "#64748B",
          fontSize: 12,
          fontWeight: "600",
        }}
      >
        {areaLabel}
      </Text>
      <Text
        style={{
          color: isDark ? "#F8FAFC" : "#0F172A",
          fontSize: 17,
          fontWeight: "800",
        }}
      >
        {market.displayLabel}
      </Text>
      <Text style={{ color: isDark ? "#94A3B8" : "#475569", fontSize: 13 }}>
        {currencyLabel} · {market.currencyCode}
      </Text>
    </View>
  );
}
