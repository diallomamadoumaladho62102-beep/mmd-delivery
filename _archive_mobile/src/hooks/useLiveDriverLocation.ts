import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

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
    supabase
      .from("driver_locations")
      .select("driver_id,lat,lng,updated_at")
      .eq("driver_id", driverId)
      .single()
      .then(({ data }) => {
        if (!mounted) return;
        if (data) setLocation(data as any);
      });

    // realtime updates
    const channel = supabase
      .channel(`driver_locations:${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_locations",
          filter: `driver_id=eq.${driverId}`,
        },
        (payload) => {
          const next = payload.new as any;
          if (next?.lat != null && next?.lng != null) setLocation(next);
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [driverId]);

  return { location };
}
