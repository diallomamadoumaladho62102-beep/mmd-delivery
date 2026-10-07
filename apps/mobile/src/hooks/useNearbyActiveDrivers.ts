import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { fetchNearbyActiveDrivers } from "../lib/taxiClientApi";
import {
  sanitizeNearbyDrivers,
  sanitizeNearbyEta,
  type NearbyEtaState,
  type NearbyMapDriver,
} from "../lib/nearbyDriversPayload";
import { supabase } from "../lib/supabase";

const REFRESH_MS = 45_000;

export type NearbyDriversSnapshot = {
  drivers: NearbyMapDriver[];
  eta: NearbyEtaState;
  status: "idle" | "loading" | "updating" | "ready" | "empty" | "error";
};

const EMPTY_ETA: NearbyEtaState = { available: false, minutes: null };
const EMPTY_NEARBY_SNAPSHOT: NearbyDriversSnapshot = {
  drivers: [],
  eta: EMPTY_ETA,
  status: "idle",
};

export function useNearbyActiveDrivers(input: {
  pickup: { lat: number; lng: number } | null;
  category: string;
  enabled: boolean;
}): NearbyDriversSnapshot {
  const [snapshot, setSnapshot] = useState<NearbyDriversSnapshot>(EMPTY_NEARBY_SNAPSHOT);
  const generation = useRef(0);

  const pickupLat = input.pickup?.lat;
  const pickupLng = input.pickup?.lng;
  const category = input.category;
  const enabled = input.enabled && Number.isFinite(pickupLat) && Number.isFinite(pickupLng);

  useEffect(() => {
    let active = true;
    const clearNearby = () => {
      generation.current += 1;
      if (active) setSnapshot(EMPTY_NEARBY_SNAPSHOT);
    };

    const { data: authSubscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") clearNearby();
    });

    const appStateSubscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh(false);
    });

    async function refresh(reset: boolean) {
      if (!enabled || pickupLat == null || pickupLng == null) {
        if (active) setSnapshot(EMPTY_NEARBY_SNAPSHOT);
        return;
      }
      const requestId = ++generation.current;
      if (reset) {
        setSnapshot({ ...EMPTY_NEARBY_SNAPSHOT, status: "loading" });
      } else if (active) {
        setSnapshot((prev) => ({
          ...prev,
          status: prev.drivers.length > 0 ? "updating" : "loading",
        }));
      }
      try {
        const payload = await fetchNearbyActiveDrivers({
          pickupLat,
          pickupLng,
          vehicleClass: category,
        });
        if (!active || requestId !== generation.current) return;
        const drivers = sanitizeNearbyDrivers(payload?.drivers);
        setSnapshot({
          drivers,
          eta: sanitizeNearbyEta(payload?.eta),
          status: drivers.length > 0 ? "ready" : "empty",
        });
      } catch {
        if (!active || requestId !== generation.current) return;
        setSnapshot({
          drivers: [],
          eta: EMPTY_ETA,
          status: "error",
        });
      }
    }

    void refresh(true);
    const timer = setInterval(() => {
      void refresh(false);
    }, REFRESH_MS);

    return () => {
      active = false;
      generation.current += 1;
      clearInterval(timer);
      authSubscription.subscription.unsubscribe();
      appStateSubscription.remove();
    };
  }, [category, enabled, pickupLat, pickupLng]);

  return snapshot;
}
