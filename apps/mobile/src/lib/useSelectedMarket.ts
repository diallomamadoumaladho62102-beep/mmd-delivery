import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";

import type { MarketCountry } from "./selectedMarket";
import { readSelectedMarket } from "./selectedMarketStore";

export function useSelectedMarket(): MarketCountry | null {
  const [market, setMarket] = useState<MarketCountry | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void readSelectedMarket().then((value) => {
        if (!cancelled) setMarket(value);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return market;
}

export function isGuineaMarket(market: MarketCountry | null | undefined): boolean {
  return market === "GN";
}
