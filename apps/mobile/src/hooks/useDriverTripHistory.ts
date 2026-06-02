import { useCallback, useEffect, useState } from "react";
import {
  loadDriverTripHistory,
  type DriverTripHistoryEntry,
} from "../lib/driverTripHistory";

export function useDriverTripHistory() {
  const [entries, setEntries] = useState<DriverTripHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await loadDriverTripHistory();
    setEntries(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    entries,
    loading,
    refresh,
    totalTrips: entries.length,
    lastTrip: entries[0] ?? null,
  };
}
