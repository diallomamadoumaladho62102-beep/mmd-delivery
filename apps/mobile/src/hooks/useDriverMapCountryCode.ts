import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  resolveDriverMapCountryCode,
  type DriverMapCountryCodeSource,
  type ResolvedDriverMapCountryCode,
} from "../lib/driverNavigation/reports/resolveCountryCode";
import type { DriverMapCountryCode } from "../lib/driverNavigation/reports/config";
import type { OrderSourceTable } from "../lib/driverNavigation/types";

type Params = {
  driverId: string | null;
  orderId?: string | null;
  sourceTable?: OrderSourceTable | null;
  orderCountryCode?: unknown;
};

type DriverProfileCountryRow = {
  operating_country?: unknown;
  country_code?: unknown;
};

type ProfileCountryRow = {
  country_code?: unknown;
};

export function useDriverMapCountryCode(params: Params): ResolvedDriverMapCountryCode & {
  isLoading: boolean;
} {
  const { driverId, orderId, sourceTable, orderCountryCode } = params;

  const [fetchedOrderCountryCode, setFetchedOrderCountryCode] = useState<unknown>(null);
  const [driverOperatingCountry, setDriverOperatingCountry] = useState<unknown>(null);
  const [driverCountryCode, setDriverCountryCode] = useState<unknown>(null);
  const [profileCountryCode, setProfileCountryCode] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadOrderCountryCode() {
      if (!orderId || !sourceTable) {
        if (!cancelled) setFetchedOrderCountryCode(null);
        return;
      }

      try {
        const table =
          sourceTable === "delivery_requests"
            ? "delivery_requests"
            : sourceTable === "taxi_rides"
              ? "taxi_rides"
              : "orders";

        const { data, error } = await supabase
          .from(table)
          .select("country_code")
          .eq("id", orderId)
          .maybeSingle();

        if (cancelled) return;

        if (error) {
          setFetchedOrderCountryCode(null);
          return;
        }

        setFetchedOrderCountryCode(data?.country_code ?? null);
      } catch {
        if (!cancelled) setFetchedOrderCountryCode(null);
      }
    }

    void loadOrderCountryCode();

    return () => {
      cancelled = true;
    };
  }, [orderId, sourceTable]);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileCountries() {
      if (!driverId) {
        if (!cancelled) {
          setDriverOperatingCountry(null);
          setDriverCountryCode(null);
          setProfileCountryCode(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);

      try {
        const [driverProfileResult, profileResult] = await Promise.all([
          supabase
            .from("driver_profiles")
            .select("operating_country, country_code")
            .eq("user_id", driverId)
            .maybeSingle(),
          supabase
            .from("profiles")
            .select("country_code")
            .eq("id", driverId)
            .maybeSingle(),
        ]);

        if (cancelled) return;

        const driverRow = driverProfileResult.data as DriverProfileCountryRow | null;
        const profileRow = profileResult.data as ProfileCountryRow | null;

        setDriverOperatingCountry(driverRow?.operating_country ?? null);
        setDriverCountryCode(driverRow?.country_code ?? null);
        setProfileCountryCode(profileRow?.country_code ?? null);
      } catch {
        if (!cancelled) {
          setDriverOperatingCountry(null);
          setDriverCountryCode(null);
          setProfileCountryCode(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadProfileCountries();

    return () => {
      cancelled = true;
    };
  }, [driverId]);

  const resolved = useMemo(
    () =>
      resolveDriverMapCountryCode({
        orderCountryCode: orderCountryCode ?? fetchedOrderCountryCode,
        driverOperatingCountry,
        driverCountryCode,
        profileCountryCode,
      }),
    [
      driverCountryCode,
      driverOperatingCountry,
      fetchedOrderCountryCode,
      orderCountryCode,
      profileCountryCode,
    ],
  );

  return {
    ...resolved,
    isLoading,
  };
}

export type { DriverMapCountryCode, DriverMapCountryCodeSource };
