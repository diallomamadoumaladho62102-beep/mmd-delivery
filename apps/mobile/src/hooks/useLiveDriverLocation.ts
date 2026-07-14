import { useEffect, useState } from "react";
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
    if (!driverId) return;

    let mounted = true;

    // initial fetch
    void supabase
      .from("driver_locations")
      .select("driver_id,lat,lng,updated_at")
      .eq("driver_id", driverId)
      .maybeSingle()
      .then(
        ({ data }) => {
          if (!mounted) return;
          if (data) setLocation(data as any);
        },
        () => {},
      );

    // realtime updates
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

    return () => {
      mounted = false;
      void unsubscribeSupabaseChannel(channel);
    };
  }, [driverId]);

  return { location };
}
