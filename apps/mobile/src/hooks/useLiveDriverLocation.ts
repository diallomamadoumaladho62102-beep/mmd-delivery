import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { supabase } from "../lib/supabase";
import {
  subscribePostgresChannel,
  unsubscribeSupabaseChannel,
} from "../lib/supabaseRealtime";

type DriverLocation = {
  driver_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

export function useLiveDriverLocation(driverId?: string | null) {
  const [location, setLocation] = useState<DriverLocation | null>(null);

  useEffect(() => {
    if (!driverId) {
      setLocation(null);
      return;
    }

    let mounted = true;

    const fetchOnce = () => {
      void supabase
        .from("driver_locations")
        .select("driver_id,lat,lng,updated_at")
        .eq("driver_id", driverId)
        .maybeSingle()
        .then(
          ({ data }) => {
            if (!mounted) return;
            setLocation(data ? (data as DriverLocation) : null);
          },
          () => {},
        );
    };

    fetchOnce();

    const channel = subscribePostgresChannel(`driver_locations:${driverId}`, [
      {
        event: "*",
        table: "driver_locations",
        filter: `driver_id=eq.${driverId}`,
        callback: (payload) => {
          if (!mounted) return;
          const next = (payload as { new?: Record<string, unknown> }).new;
          if (next?.lat != null && next?.lng != null) setLocation(next as DriverLocation);
        },
      },
    ]);

    const appSub = AppState.addEventListener("change", (state) => {
      if (state === "active") fetchOnce();
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_OUT" || !mounted) return;
      mounted = false;
      setLocation(null);
      void unsubscribeSupabaseChannel(channel);
    });

    return () => {
      mounted = false;
      appSub.remove();
      authSub.subscription.unsubscribe();
      void unsubscribeSupabaseChannel(channel);
    };
  }, [driverId]);

  return { location };
}
