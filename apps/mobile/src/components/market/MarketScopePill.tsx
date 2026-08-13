import React from "react";
import { View, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { UnifiedMarketScope } from "../../lib/marketScope";
import { MMD_BLUE, MMD_STROKE, MMD_WHITE } from "../../theme/mmdUi";

type Props = {
  market: UnifiedMarketScope;
  /** Light pills match the legacy Driver Home mockup header. */
  variant?: "dark" | "light" | "mmd";
};

export default function MarketScopePill({ market, variant = "dark" }: Props) {
  if (!market.scopeResolved) return null;

  const light = variant === "light";
  const mmd = variant === "mmd";

  return (
    <View
      style={{
        alignSelf: light || mmd ? "stretch" : "flex-start",
        paddingHorizontal: light || mmd ? 12 : 10,
        paddingVertical: light || mmd ? 0 : 6,
        borderRadius: 999,
        backgroundColor: mmd
          ? MMD_BLUE
          : light
            ? "#FFFFFF"
            : "rgba(15,23,42,0.88)",
        borderWidth: mmd ? 1.5 : 1,
        borderColor: mmd
          ? MMD_STROKE
          : light
            ? "#E5E7EB"
            : "rgba(148,163,184,0.35)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        minHeight: light || mmd ? 32 : undefined,
        gap: 4,
      }}
    >
      {light ? <Ionicons name="location" size={14} color="#16A34A" /> : null}
      <Text
        style={{
          color: mmd || !light ? (mmd ? MMD_WHITE : "#E2E8F0") : "#0F172A",
          fontSize: light || mmd ? 12 : 11,
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
