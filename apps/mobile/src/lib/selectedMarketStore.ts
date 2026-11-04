import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "./supabase";
import {
  asMarketCountry,
  type MarketCountry,
} from "./selectedMarket";

const SELECTED_MARKET_KEY = "mmd_selected_market_v1";

export async function readSelectedMarket(): Promise<MarketCountry | null> {
  try {
    const stored = await AsyncStorage.getItem(SELECTED_MARKET_KEY);
    return asMarketCountry(stored);
  } catch {
    return null;
  }
}

export async function saveSelectedMarket(country: MarketCountry): Promise<void> {
  await AsyncStorage.setItem(SELECTED_MARKET_KEY, country);
}

/**
 * Existing accounts may already store US or GN. Any other value, or a missing
 * profile, stays unresolved so the person chooses instead of being assigned.
 * This preference does not rewrite currency or payment on existing orders.
 */
export async function readAccountMarket(userId: string): Promise<MarketCountry | null> {
  const id = String(userId ?? "").trim();
  if (!id) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("country_code, country")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { country_code?: unknown; country?: unknown };
    return asMarketCountry(row.country_code) ?? asMarketCountry(row.country);
  } catch {
    return null;
  }
}

export async function resolveStartupMarket(
  userId?: string | null,
): Promise<MarketCountry | null> {
  const stored = await readSelectedMarket();
  if (stored) return stored;
  const accountMarket = userId ? await readAccountMarket(userId) : null;
  if (!accountMarket) return null;
  try {
    await saveSelectedMarket(accountMarket);
  } catch {
    // The choice is still known for this launch even if storage fails.
  }
  return accountMarket;
}
