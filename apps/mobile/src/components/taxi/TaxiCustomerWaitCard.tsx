import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  fetchTaxiCustomerWait,
  type TaxiCustomerWaitStatus,
} from "../../lib/taxiClientApi";
import { formatTimer, formatWaitFee } from "../../lib/waitTimerFormat";

type Props = {
  rideId: string;
};

function serverOffsetMs(serverNow: string | undefined): number {
  const server = serverNow ? new Date(serverNow).getTime() : Date.now();
  if (!Number.isFinite(server)) return 0;
  return server - Date.now();
}

export function TaxiCustomerWaitCard({ rideId }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TaxiCustomerWaitStatus | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(Date.now());
  const [syncedAt, setSyncedAt] = useState(0);
  const [stale, setStale] = useState(false);
  const minuteBucketRef = useRef(-1);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchTaxiCustomerWait(rideId);
      if (!next?.ok) {
        setStale(true);
        return;
      }
      setStatus(next);
      setOffsetMs(serverOffsetMs(next.server_now));
      setSyncedAt(Date.now());
      setStale(false);
    } catch {
      setStale(true);
    }
  }, [rideId]);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), 15_000);
    const tick = setInterval(() => setNowMs(Date.now()), 1_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      sub.remove();
    };
  }, [refresh]);

  const startedMs = status?.wait_started_at
    ? new Date(status.wait_started_at).getTime()
    : NaN;
  const liveElapsed =
    Number.isFinite(startedMs) && status?.wait_active
      ? Math.max(0, Math.floor((nowMs + offsetMs - startedMs) / 1000))
      : status?.elapsed_seconds ?? 0;
  const freeSeconds = Math.max(0, (status?.free_wait_minutes ?? 5) * 60);
  const remaining = status?.wait_active
    ? Math.max(0, freeSeconds - liveElapsed)
    : status?.remaining_free_seconds ?? 0;
  const feeCents = status?.wait_fee_cents ?? 0;
  const currency = status?.currency ?? "USD";

  useEffect(() => {
    if (!status?.wait_active) return;
    const bucket = Math.floor(liveElapsed / 60);
    if (minuteBucketRef.current < 0) {
      minuteBucketRef.current = bucket;
      return;
    }
    if (bucket !== minuteBucketRef.current) {
      minuteBucketRef.current = bucket;
      void refresh();
    }
  }, [liveElapsed, refresh, status?.wait_active]);

  if (!status?.wait_started_at && !status?.wait_active) return null;

  return (
    <View
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 16,
        backgroundColor: "rgba(10,10,18,0.92)",
        borderWidth: 1,
        borderColor: "#D6B25E",
        gap: 6,
      }}
    >
      <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
        {t("taxi.tracking.waitTitle", "Driver arrived")}
      </Text>
      <Text style={{ color: "#CBD5E1" }}>
        {t("taxi.tracking.waitClock", "Waiting time")}
      </Text>
      {remaining > 0 ? (
        <Text style={{ color: "#F8FAFC", fontSize: 22, fontVariant: ["tabular-nums"] }}>
          {t("taxi.tracking.waitFree", "Free waiting")}: {formatTimer(remaining)}{" "}
          {t("taxi.tracking.waitRemaining", "remaining")}
        </Text>
      ) : (
        <Text style={{ color: "#F8FAFC", fontSize: 22, fontVariant: ["tabular-nums"] }}>
          {formatTimer(liveElapsed)}
        </Text>
      )}
      <Text style={{ color: "#F8FAFC", fontWeight: "700" }}>
        {t("taxi.tracking.waitFee", "Waiting fee")}: {formatWaitFee(feeCents, currency)}
      </Text>
      {status.max_fee_reached ? (
        <Text style={{ color: "#FDE68A" }}>
          {t(
            "taxi.tracking.waitMax",
            "The maximum waiting charge has been reached.",
          )}
        </Text>
      ) : null}
      {stale || Date.now() - syncedAt > 45_000 ? (
        <Text style={{ color: "#FCA5A5" }}>
          {t("taxi.tracking.waitStale", "Waiting status is out of date. Reconnecting…")}
        </Text>
      ) : null}
    </View>
  );
}
