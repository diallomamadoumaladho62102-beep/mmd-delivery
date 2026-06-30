import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { supabase } from "../../../lib/supabase";
import {
  fetchRestaurantAiGrowth,
  fetchRestaurantCommandCenter,
  type RestaurantAiGrowthData,
  type RestaurantCommandCenterData,
} from "../../../lib/restaurantCommandCenterApi";

type UseRestaurantCommandCenterResult = {
  data: RestaurantCommandCenterData | null;
  aiGrowth: RestaurantAiGrowthData | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  restaurantUserId: string | null;
  refresh: () => Promise<void>;
  silentRefresh: () => Promise<void>;
};

export function useRestaurantCommandCenter(): UseRestaurantCommandCenterResult {
  const isFocused = useIsFocused();
  const [restaurantUserId, setRestaurantUserId] = useState<string | null>(null);
  const [data, setData] = useState<RestaurantCommandCenterData | null>(null);
  const [aiGrowth, setAiGrowth] = useState<RestaurantAiGrowthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshLock = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (cancelled) return;
      setRestaurantUserId(sessionData.session?.user?.id ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setRestaurantUserId(session?.user?.id ?? null);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean; pull?: boolean }) => {
    if (refreshLock.current) return;
    refreshLock.current = true;

    try {
      setError(null);
      if (opts?.pull) setRefreshing(true);
      else if (!opts?.silent) setLoading(true);

      const [commandCenter, growth] = await Promise.all([
        fetchRestaurantCommandCenter(),
        fetchRestaurantAiGrowth(),
      ]);

      setData(commandCenter);
      setAiGrowth(growth);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "LOAD_FAILED";
      setError(message);
    } finally {
      if (opts?.pull) setRefreshing(false);
      else if (!opts?.silent) setLoading(false);
      refreshLock.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    await load({ pull: true });
  }, [load]);

  const silentRefresh = useCallback(async () => {
    await load({ silent: true });
  }, [load]);

  useEffect(() => {
    if (!restaurantUserId || !isFocused) return;
    void load();
  }, [restaurantUserId, isFocused, load]);

  useEffect(() => {
    if (!restaurantUserId || !isFocused) return;

    const channel = supabase
      .channel(`restaurant-command-center:${restaurantUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantUserId}`,
        },
        () => {
          void silentRefresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_locations",
        },
        () => {
          void silentRefresh();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "restaurant_profiles",
          filter: `user_id=eq.${restaurantUserId}`,
        },
        () => {
          void silentRefresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [restaurantUserId, isFocused, silentRefresh]);

  useEffect(() => {
    if (!restaurantUserId || !isFocused) return;

    const onAppState = (state: AppStateStatus) => {
      if (state === "active") void silentRefresh();
    };

    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [restaurantUserId, isFocused, silentRefresh]);

  return {
    data,
    aiGrowth,
    loading,
    refreshing,
    error,
    restaurantUserId,
    refresh,
    silentRefresh,
  };
}
