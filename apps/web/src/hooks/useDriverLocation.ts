"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseBrowser";

export type DriverLocation = {
  driver_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

type State = {
  location: DriverLocation | null;
  loading: boolean;
  error: string | null;
};

/**
 * Récupère la DERNIÈRE position connue d'un chauffeur,
 * et écoute les nouvelles positions en temps réel.
 */
export function useDriverLocation(driverId: string | null): State {
  const [location, setLocation] = useState<DriverLocation | null>(null);
  const [loading, setLoading] = useState<boolean>(!!driverId);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!driverId) {
      setLocation(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetchLatest() {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from("driver_locations")
        .select("driver_id, lat, lng, updated_at")
        .eq("driver_id", driverId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        setError(error.message);
        setLocation(null);
      } else if (data) {
        setLocation(data as DriverLocation);
      }

      setLoading(false);
    }

    fetchLatest();

    // 🔥 Abonnement temps réel
    const channel = supabase
      .channel("driver-location-" + driverId)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "driver_locations",
          filter: "driver_id=eq." + driverId,
        },
        (payload) => {
          setLocation(payload.new as DriverLocation);
          setLoading(false);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [driverId]);

  return { location, loading, error };
}
